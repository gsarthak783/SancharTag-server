const interactionService = require('../dbServices/interactionService');
const archiveService = require('../dbServices/archiveService');
const messageService = require('../services/messageService');
const errorCodes = require('../config/errorCodes');
const { handleResponse, handleError } = require('../utils/requestHandlers');
const { SENDER_ROLE, INTERACTION_STATUS } = require('../constants/interaction');

// Scanner sees the conversation, never the owner's identifiers or capture data.
const scannerView = (interaction) => ({
    interactionId: interaction.interactionId,
    status: interaction.status,
    contactType: interaction.contactType,
    messages: interaction.messages,
    lastMessage: interaction.lastMessage,
    createdAt: interaction.createdAt,
    resolvedAt: interaction.resolvedAt,
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
        const interaction = await interactionService.getByInteractionId(interactionId);
        if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;

        if (req.user) {
            if (interaction.userId !== req.user.userId) throw errorCodes.NOT_OWNER;
            return handleResponse({ res, data: interaction });
        }
        if (req.scanner.interactionId !== interactionId) throw errorCodes.INVALID_INTERACTION_TOKEN;
        handleResponse({ res, data: scannerView(interaction) });
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
