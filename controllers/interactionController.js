const interactionService = require('../dbServices/interactionService');
const chatMessageService = require('../dbServices/chatMessageService');
const archiveService = require('../dbServices/archiveService');
const messageService = require('../services/messageService');
const mediaService = require('../services/mediaService');
const errorCodes = require('../config/errorCodes');
const { handleResponse, handleError } = require('../utils/requestHandlers');
const { SENDER_ROLE, INTERACTION_STATUS } = require('../constants/interaction');

// Chat v2: messages come from their own collection, latest page first
// (?beforeSeq= pages further back). Falls back to a legacy embedded array on
// docs the migration hasn't touched.
const loadMessages = async (interaction, { beforeSeq, limit } = {}) => {
    if (!interaction.seq && interaction.messages?.length) return interaction.messages;
    const rows = await chatMessageService.listPage(interaction.interactionId, { beforeSeq, limit });
    return mediaService.withMediaUrls(rows.map(messageService.wireMessage));
};

// Scanner sees the conversation, never the owner's identifiers or capture data.
const scannerView = (interaction, messages) => ({
    interactionId: interaction.interactionId,
    status: interaction.status,
    contactType: interaction.contactType,
    messages,
    lastMessage: interaction.lastMessage,
    createdAt: interaction.createdAt,
    resolvedAt: interaction.resolvedAt,
    seq: interaction.seq ?? 0,
    receipts: interaction.receipts ?? null,
});

exports.list = async (req, res) => {
    try {
        const { page, limit, status } = req.query;
        const data = await interactionService.listByUser(req.user.userId, { page, limit, status });
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

// authenticateAny ran: owners must own it, scanners must hold ITS token.
exports.getOne = async (req, res) => {
    try {
        const { interactionId } = req.params;
        // Scanner scope check FIRST — an out-of-scope token learns nothing,
        // not even whether the interaction exists.
        if (req.scanner && req.scanner.interactionId !== interactionId) {
            throw errorCodes.INVALID_INTERACTION_TOKEN;
        }

        const interaction = await interactionService.getByInteractionId(interactionId);
        if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;

        const { beforeSeq, limit } = req.query;

        if (req.user) {
            if (interaction.userId !== req.user.userId) throw errorCodes.NOT_OWNER;
            // Messages and the block check are independent — one DB roundtrip
            // of latency, not two (each hop is ~200ms until the region move).
            const userService = require('../dbServices/userService');
            const [messages, scannerBlocked] = await Promise.all([
                loadMessages(interaction, { beforeSeq, limit }),
                // Blocking never rewrites a finished session's status — this
                // flag is how the chat header shows both truths.
                interaction.scanner?.phoneNumber
                    ? userService.isBlocked(interaction.userId, interaction.scanner.phoneNumber)
                    : Promise.resolve(false),
            ]);
            return handleResponse({ res, data: { ...interaction, messages, scannerBlocked } });
        }
        const messages = await loadMessages(interaction, { beforeSeq, limit });
        handleResponse({ res, data: scannerView(interaction, messages) });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.sendMessage = async (req, res) => {
    try {
        const { interactionId } = req.params;
        // Identity → role. Nothing about the sender comes from the payload.
        let senderRole;
        if (req.user) {
            senderRole = SENDER_ROLE.OWNER;
        } else {
            if (req.scanner.interactionId !== interactionId) throw errorCodes.INVALID_INTERACTION_TOKEN;
            senderRole = SENDER_ROLE.SCANNER;
        }
        const { message } = await messageService.sendMessage({
            interactionId,
            senderRole,
            text: req.body.text,
            // Optional idempotency key (chat v2 outbox retries over REST).
            clientId: typeof req.body.clientId === 'string' ? req.body.clientId.slice(0, 80) : null,
            asOwnerUserId: req.user?.userId || null,
        });
        handleResponse({ res, statusCode: 201, data: message });
    } catch (error) {
        handleError({ res, error });
    }
};

// Photo message: normalize (EXIF/GPS stripped, resized) → R2 → the SAME
// sendMessage path as text, so session rules, dedupe and fan-out all hold.
exports.uploadMedia = async (req, res) => {
    try {
        const { interactionId } = req.params;
        let senderRole;
        if (req.user) {
            senderRole = SENDER_ROLE.OWNER;
        } else {
            if (req.scanner.interactionId !== interactionId) throw errorCodes.INVALID_INTERACTION_TOKEN;
            senderRole = SENDER_ROLE.SCANNER;
        }
        if (!mediaService.enabled()) throw errorCodes.MEDIA_DISABLED;
        if (!req.file?.buffer) throw errorCodes.MEDIA_INVALID;

        const { buffer, media } = await mediaService.processImage(req.file.buffer);
        const key = await mediaService.store(interactionId, buffer);

        const caption = typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 500) : '';
        const { message } = await messageService.sendMessage({
            interactionId,
            senderRole,
            text: caption,
            type: 'image',
            media: { ...media, key },
            clientId: typeof req.body.clientId === 'string' ? req.body.clientId.slice(0, 80) : null,
            asOwnerUserId: req.user?.userId || null,
        });
        handleResponse({ res, statusCode: 201, data: message });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.updateStatus = async (req, res) => {
    try {
        const data = await messageService.updateStatusAndNotify({
            interactionId: req.resource.interactionId,
            status: req.body.status,
            endedBy: SENDER_ROLE.OWNER,
        });
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.resolve = async (req, res) => {
    try {
        const data = await messageService.updateStatusAndNotify({
            interactionId: req.resource.interactionId,
            status: INTERACTION_STATUS.RESOLVED,
            endedBy: SENDER_ROLE.OWNER,
        });
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.markRead = async (req, res) => {
    try {
        const data = await interactionService.markRead(req.resource.interactionId);
        // Blue-tick fan-out to the scanner side (idempotent cursor).
        if (data?.seq > 0) {
            const sockets = require('../sockets');
            sockets.emitToInteraction(data.interactionId, 'msg:status', {
                interactionId: data.interactionId,
                role: SENDER_ROLE.OWNER,
                kind: 'read',
                upToSeq: data.receipts?.owner?.read ?? data.seq,
            });
        }
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.remove = async (req, res) => {
    try {
        const { interactionId } = req.resource;
        const doc = await interactionService.remove(interactionId);
        if (doc) await archiveService.archiveInteractions([doc], req.user.userId);
        handleResponse({ res, message: 'Interaction deleted', data: { interactionId } });
    } catch (error) {
        handleError({ res, error });
    }
};
