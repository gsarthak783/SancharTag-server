const interactionService = require('../dbServices/interactionService');
const chatMessageService = require('../dbServices/chatMessageService');
const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const notificationService = require('./notificationService');
// Module object (not destructured): sockets ↔ services is a require cycle, and
// property lookup at call time resolves it safely.
const sockets = require('../sockets');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
const mediaService = require('./mediaService');
const { generateMessageId } = require('../utils/ids');
const {
    INTERACTION_STATUS,
    SENDER_ROLE,
    MESSAGE_TYPE,
} = require('../constants/interaction');

const notifyOwnerOfMessage = async (interaction, text, messageId) => {
    // The owner has this exact chat on screen — the message just rendered
    // live over the socket; a push would only duplicate it.
    if (await sockets.ownerInInteractionRoom(interaction.interactionId)) return;
    const owner = await userService.getByUserId(interaction.userId);
    if (!owner?.notificationPreferences?.chatMessages) return;
    const vehicle = await vehicleService.getByVehicleId(interaction.vehicleId);
    // Push only — the chat thread is its own record; an inbox row per
    // message would drown the bell. messageId dedupes retries.
    await notificationService.notifyUser({
        userId: interaction.userId,
        eventKey: 'new_message',
        dedupeKey: `msg:${messageId}`,
        title: `New message about ${vehicle?.vehicleNumber || 'your vehicle'}`,
        body: text.slice(0, 120),
        data: { interactionId: interaction.interactionId, type: 'new_message' },
        channels: ['push'],
    });
};

// Legacy receive_message consumers expect these field names; v2 clients read
// the extra seq/clientId. One wire shape serves both during the rollout.
const wireMessage = (row) => ({
    messageId: row.messageId,
    senderRole: row.senderRole,
    text: row.text,
    type: row.type,
    timestamp: row.createdAt || row.timestamp,
    isRead: false,
    seq: row.seq,
    clientId: row.clientId,
    ...(row.replyTo?.messageId && { replyTo: row.replyTo }),
    ...(row.media?.key && { media: row.media }),
});
exports.wireMessage = wireMessage;

/**
 * THE single message path — REST and socket both land here, so session-state
 * and block rules cannot diverge between transports.
 *  - senderRole comes from the authenticated identity, never the payload
 *  - block check runs BEFORE any write
 *  - clientId + the unique message index make retries exactly-once: a replay
 *    returns the original row (duplicate: true) and emits NOTHING
 *  - seq claim is atomic and refuses non-active sessions (no reactivation)
 */
exports.sendMessage = async ({
    interactionId,
    senderRole,
    text,
    type = MESSAGE_TYPE.TEXT,
    asOwnerUserId = null,
    clientId = null,
    replyTo = null,
    media = null,
}) => {
    const interaction = await interactionService.getByInteractionId(interactionId);
    if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;
    if (senderRole === SENDER_ROLE.OWNER && asOwnerUserId && interaction.userId !== asOwnerUserId) {
        throw errorCodes.NOT_OWNER;
    }

    // Retry short-circuit BEFORE any check that could have changed since the
    // first attempt — the ack the client lost must be reproducible.
    const effectiveClientId = clientId || generateMessageId();
    if (clientId) {
        const existing = await chatMessageService.findByClient(interactionId, senderRole, clientId);
        if (existing) return { message: wireMessage(existing), interaction, duplicate: true };
    }

    if (interaction.status !== INTERACTION_STATUS.ACTIVE) throw errorCodes.SESSION_ENDED;

    if (senderRole === SENDER_ROLE.SCANNER && interaction.scanner?.phoneNumber) {
        if (await userService.isBlocked(interaction.userId, interaction.scanner.phoneNumber)) {
            throw errorCodes.BLOCKED_BY_OWNER;
        }
    }

    const displayText = text
        || (type === MESSAGE_TYPE.VOICE ? '\ud83c\udfa4 Voice message' : '')
        || (type === MESSAGE_TYPE.IMAGE ? '\ud83d\udcf7 Photo' : '');
    const updated = await interactionService.claimNextSeq(interactionId, { senderRole, text: displayText, type });
    if (!updated) throw errorCodes.SESSION_ENDED; // lost a race with resolve/report

    const { message: row, duplicate } = await chatMessageService.insert({
        conversationId: interactionId,
        senderRole,
        clientId: effectiveClientId,
        seq: updated.seq,
        text,
        type,
        replyTo,
        media,
    });
    const message = wireMessage(row);
    if (message.media?.key) {
        message.mediaUrl = await mediaService.signedUrl(message.media.key).catch(() => null);
    }
    if (duplicate) return { message, interaction: updated, duplicate: true };

    // Sender's own cursors implicitly cover their message.
    interactionService.advanceReceipt(interactionId, senderRole, 'read', row.seq).catch(() => { });
    interactionService.advanceReceipt(interactionId, senderRole, 'delivered', row.seq).catch(() => { });

    sockets.emitToInteraction(interactionId, 'receive_message', message);
    sockets.emitToUser(interaction.userId, 'interaction_update', {
        interactionId,
        contactType: updated.contactType,
        lastMessage: updated.lastMessage,
        status: updated.status,
        unreadCount: updated.unreadCount,
        message,
    });

    if (senderRole === SENDER_ROLE.SCANNER) {
        notifyOwnerOfMessage(interaction, displayText, row.messageId).catch((err) => {
            logger.error('message push failed', { error: err.message, interactionId });
        });
    }

    return { message, interaction: updated, duplicate: false };
};

/**
 * Receipt cursor advance ($max — never moves backwards) + tick fan-out.
 * Idempotent by construction: re-emits on reconnect are free.
 */
exports.advanceReceipt = async ({ interactionId, role, kind, upToSeq }) => {
    const updated = await interactionService.advanceReceipt(interactionId, role, kind, upToSeq);
    if (!updated) throw errorCodes.INTERACTION_NOT_FOUND;
    sockets.emitToInteraction(interactionId, 'msg:status', {
        interactionId,
        role,
        kind,
        upToSeq: updated.receipts?.[role]?.[kind] ?? +upToSeq,
    });
    if (role === SENDER_ROLE.OWNER && kind === 'read') {
        // Badge = scanner messages past the read cursor (a partial read —
        // cursor behind seq — keeps the remainder unread, unlike a blunt 0).
        const cursor = updated.receipts?.owner?.read ?? +upToSeq;
        const remaining = await chatMessageService.countAfter(interactionId, SENDER_ROLE.SCANNER, cursor);
        await interactionService.setUnreadCount(interactionId, remaining);
        sockets.emitToUser(updated.userId, 'interaction_update', {
            interactionId,
            unreadCount: remaining,
        });
    }
    return updated;
};

/**
 * Status transitions with the real-time fan-out (used by REST status/resolve
 * and the socket end_session event).
 */
exports.updateStatusAndNotify = async ({ interactionId, status, endedBy = null }) => {
    const updated = await interactionService.updateStatus(interactionId, status);
    if (!updated) throw errorCodes.INTERACTION_NOT_FOUND;

    if (status !== INTERACTION_STATUS.ACTIVE) {
        sockets.emitToInteraction(interactionId, 'session_ended', { status, ...(endedBy && { endedBy }) });
    }
    sockets.emitToUser(updated.userId, 'interaction_update', { interactionId, status });
    return updated;
};
