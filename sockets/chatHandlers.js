const interactionService = require('../dbServices/interactionService');
const messageService = require('../services/messageService');
const { consumeMessageBudget } = require('../middlewares/rateLimiter/messages');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
const { SENDER_ROLE, INTERACTION_STATUS } = require('../constants/interaction');

const emitError = (socket, error) => {
    socket.emit('app_error', {
        code: error?.code || 'INTERNAL_ERROR',
        message: error?.en || error?.message || 'Something went wrong',
    });
};

// Resolves which interaction this socket may act on. Scanners are pinned to
// their token's interaction; owners must have joined the room (join_room
// performs the ownership check), so membership == authorization.
const resolveInteractionId = (socket, requestedId) => {
    const { identity } = socket.data;
    if (identity.role === SENDER_ROLE.SCANNER) return identity.interactionId;
    if (requestedId && socket.rooms.has(`interaction:${requestedId}`)) return requestedId;
    return null;
};

module.exports = (io, socket) => {
    const { identity } = socket.data;

    // Owner opens a chat: verify ownership, then join.
    socket.on('join_room', async (interactionId) => {
        try {
            if (identity.role !== SENDER_ROLE.OWNER) return; // scanners are auto-joined to theirs
            const interaction = await interactionService.getByInteractionId(interactionId);
            if (!interaction || interaction.userId !== identity.userId) {
                return emitError(socket, errorCodes.NOT_OWNER);
            }
            socket.join(`interaction:${interactionId}`);
        } catch (error) {
            logger.error('join_room failed', { error: error.message });
            emitError(socket, error);
        }
    });

    socket.on('leave_room', (interactionId) => {
        socket.leave(`interaction:${interactionId}`);
    });

    socket.on('send_message', async (data = {}) => {
        try {
            const interactionId = resolveInteractionId(socket, data.interactionId);
            if (!interactionId) return emitError(socket, errorCodes.NOT_OWNER);

            const text = typeof data.text === 'string' ? data.text.trim() : '';
            if (!text) return emitError(socket, errorCodes.MESSAGE_TEXT_REQUIRED);
            if (!(await consumeMessageBudget(interactionId))) {
                return emitError(socket, errorCodes.RATE_LIMITED);
            }

            await messageService.sendMessage({
                interactionId,
                senderRole: identity.role, // from the authenticated socket, never the payload
                text,
                asOwnerUserId: identity.role === SENDER_ROLE.OWNER ? identity.userId : null,
            });
            // Delivery happens via messageService's receive_message broadcast.
        } catch (error) {
            emitError(socket, error);
        }
    });

    socket.on('end_session', async (data = {}) => {
        try {
            const interactionId = resolveInteractionId(socket, data.interactionId);
            if (!interactionId) return emitError(socket, errorCodes.NOT_OWNER);
            await messageService.updateStatusAndNotify({
                interactionId,
                status: INTERACTION_STATUS.RESOLVED,
                endedBy: identity.role,
            });
        } catch (error) {
            emitError(socket, error);
        }
    });
};
