const interactionService = require('../dbServices/interactionService');
const chatMessageService = require('../dbServices/chatMessageService');
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

    // --- Chat v2 (feature 04) — versioned rollout alongside the legacy events ---

    // Reliable send: the ack callback IS the "sent" tick. Clients retry with
    // the same clientId until acked; the unique index collapses the retries.
    socket.on('msg:send', async (data = {}, cb) => {
        const ack = typeof cb === 'function' ? cb : () => { };
        try {
            const interactionId = resolveInteractionId(socket, data.interactionId);
            if (!interactionId) return ack({ ok: false, code: 'NOT_OWNER' });

            const text = typeof data.text === 'string' ? data.text.trim() : '';
            if (!text) return ack({ ok: false, code: 'MESSAGE_TEXT_REQUIRED' });
            const clientId = typeof data.clientId === 'string' && data.clientId
                ? String(data.clientId).slice(0, 80)
                : null;
            if (!clientId) return ack({ ok: false, code: 'VALIDATION_FAILED' });
            if (!(await consumeMessageBudget(interactionId))) {
                return ack({ ok: false, code: 'RATE_LIMITED', retryable: true });
            }

            const replyTo = data.replyTo?.messageId ? {
                messageId: String(data.replyTo.messageId).slice(0, 60),
                senderRole: data.replyTo.senderRole === 'owner' ? 'owner' : 'scanner',
                snippet: String(data.replyTo.snippet || '').slice(0, 140),
            } : null;

            const { message } = await messageService.sendMessage({
                interactionId,
                senderRole: identity.role,
                text,
                clientId,
                replyTo,
                asOwnerUserId: identity.role === SENDER_ROLE.OWNER ? identity.userId : null,
            });
            ack({ ok: true, messageId: message.messageId, seq: message.seq, at: message.timestamp });
        } catch (error) {
            // Network-ish failures are retryable; rule violations are not.
            const code = error?.code || 'INTERNAL_ERROR';
            ack({ ok: false, code, retryable: code === 'INTERNAL_ERROR' });
        }
    });

    // Receipt cursors — idempotent ($max), re-emitted freely on reconnect.
    const onReceipt = (kind) => async (data = {}) => {
        try {
            const interactionId = resolveInteractionId(socket, data.interactionId);
            if (!interactionId || !(+data.upToSeq > 0)) return;
            await messageService.advanceReceipt({
                interactionId,
                role: identity.role,
                kind,
                upToSeq: +data.upToSeq,
            });
        } catch { /* cursor advances are best-effort; reconnect re-sends them */ }
    };
    socket.on('msg:delivered', onReceipt('delivered'));
    socket.on('msg:read', onReceipt('read'));

    // Reconnect sync: everything after the client's high-water mark, plus the
    // current cursors — doubles as the offline-delivery trigger.
    socket.on('msg:sync', async (data = {}, cb) => {
        const ack = typeof cb === 'function' ? cb : () => { };
        try {
            const interactionId = resolveInteractionId(socket, data.interactionId);
            if (!interactionId) return ack({ ok: false, code: 'NOT_OWNER' });
            const [rows, interaction] = await Promise.all([
                chatMessageService.listSince(interactionId, +data.sinceSeq || 0),
                interactionService.getByInteractionId(interactionId),
            ]);
            ack({
                ok: true,
                messages: rows.map(messageService.wireMessage),
                seq: interaction?.seq ?? 0,
                receipts: interaction?.receipts ?? null,
                status: interaction?.status,
            });
        } catch (error) {
            ack({ ok: false, code: error?.code || 'INTERNAL_ERROR' });
        }
    });

    // Typing is ephemeral by design: volatile, never persisted, 5s expiry on
    // the receiving side.
    socket.on('typing', (data = {}) => {
        const interactionId = resolveInteractionId(socket, data.interactionId);
        if (!interactionId) return;
        socket.volatile.to(`interaction:${interactionId}`).emit('typing', {
            interactionId,
            role: identity.role,
            on: !!data.on,
        });
    });
};
