const interactionService = require('../dbServices/interactionService');
const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const notificationService = require('./notificationService');
// Module object (not destructured): sockets ↔ services is a require cycle, and
// property lookup at call time resolves it safely.
const sockets = require('../sockets');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
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

/**
 * THE single message path — REST and socket both land here, so session-state
 * and block rules cannot diverge between transports.
 *  - senderRole comes from the authenticated identity, never the payload
 *  - block check runs BEFORE any write
 *  - append is atomic and refuses non-active sessions (no reactivation)
 */
exports.sendMessage = async ({ interactionId, senderRole, text, type = MESSAGE_TYPE.TEXT, asOwnerUserId = null }) => {
    const interaction = await interactionService.getByInteractionId(interactionId);
    if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;
    if (senderRole === SENDER_ROLE.OWNER && asOwnerUserId && interaction.userId !== asOwnerUserId) {
        throw errorCodes.NOT_OWNER;
    }
    if (interaction.status !== INTERACTION_STATUS.ACTIVE) throw errorCodes.SESSION_ENDED;

    if (senderRole === SENDER_ROLE.SCANNER && interaction.scanner?.phoneNumber) {
        if (await userService.isBlocked(interaction.userId, interaction.scanner.phoneNumber)) {
            throw errorCodes.BLOCKED_BY_OWNER;
        }
    }

    const message = {
        messageId: generateMessageId(),
        senderRole,
        text,
        type,
        timestamp: new Date(),
        isRead: false,
    };

    const updated = await interactionService.pushMessageIfActive(interactionId, message);
    if (!updated) throw errorCodes.SESSION_ENDED; // lost a race with resolve/report

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
        notifyOwnerOfMessage(interaction, text, message.messageId).catch((err) => {
            logger.error('message push failed', { error: err.message, interactionId });
        });
    }

    return { message, interaction: updated };
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
