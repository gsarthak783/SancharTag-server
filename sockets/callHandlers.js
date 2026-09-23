const interactionService = require('../dbServices/interactionService');
const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const messageService = require('../services/messageService');
const notificationService = require('../services/notificationService');
const pendingCallStore = require('../utils/pendingCallStore');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
const { SENDER_ROLE, INTERACTION_STATUS, CONTACT_TYPE, MESSAGE_TYPE } = require('../constants/interaction');

const emitError = (socket, error) => {
    socket.emit('app_error', {
        code: error?.code || 'INTERNAL_ERROR',
        message: error?.en || error?.message || 'Something went wrong',
    });
};

/**
 * WebRTC signaling relay — symmetric: either party may call while the
 * interaction is ACTIVE. All signaling flows through the interaction room
 * (scanner is auto-joined at handshake; the owner is joined when the chat
 * screen opens, or server-side on answer). Identity always comes from the
 * socket; clients never address arbitrary targets.
 *
 * Delivery asymmetry: scanner→owner also fans out to the owner's user room,
 * buffers in pendingCallStore, and pushes (owner may not have the chat open).
 * owner→scanner is room-only — a web scanner is only reachable while its
 * socket is connected, which is exactly the open-session case.
 */
module.exports = (io, socket) => {
    const { identity } = socket.data;

    // Resolve + authorize the interaction this socket may signal on.
    const resolveCallContext = async (requestedId) => {
        const interactionId = identity.role === SENDER_ROLE.SCANNER
            ? identity.interactionId
            : requestedId;
        if (!interactionId) throw errorCodes.INTERACTION_NOT_FOUND;
        const interaction = await interactionService.getByInteractionId(interactionId);
        if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;
        if (identity.role === SENDER_ROLE.OWNER && interaction.userId !== identity.userId) {
            throw errorCodes.NOT_OWNER;
        }
        return interaction;
    };

    socket.on('callUser', async (data = {}) => {
        try {
            const interaction = await resolveCallContext(data.interactionId);
            const { interactionId } = interaction;

            if (interaction.status !== INTERACTION_STATUS.ACTIVE) {
                return emitError(socket, errorCodes.SESSION_ENDED);
            }
            if (interaction.scanner?.phoneNumber
                && await userService.isBlocked(interaction.userId, interaction.scanner.phoneNumber)) {
                return emitError(socket, errorCodes.BLOCKED_BY_OWNER);
            }

            socket.data.ownerUserId = interaction.userId;
            socket.join(`interaction:${interactionId}`); // owner may call from outside the chat screen

            await interactionService.setContactType(interactionId, CONTACT_TYPE.CALL);

            const callPayload = {
                signal: data.signalData,
                interactionId,
                name: data.name
                    || (identity.role === SENDER_ROLE.SCANNER ? (interaction.scanner?.name || 'Scanner') : 'Owner'),
                fromRole: identity.role,
            };

            if (identity.role === SENDER_ROLE.SCANNER) {
                // Owner might not be in the chat: user-room fanout (covers the
                // in-chat case too — owner is always in their user room, and
                // room-only emit would double-deliver).
                io.to(`user:${interaction.userId}`).emit('callMade', callPayload);
                pendingCallStore.set(interaction.userId, callPayload);

                (async () => {
                    const owner = await userService.getWithPushToken(interaction.userId);
                    if (!owner?.pushToken || !owner.notificationPreferences?.pushEnabled) return;
                    const vehicle = await vehicleService.getByVehicleId(interaction.vehicleId);
                    await notificationService.sendPushNotification(
                        owner.pushToken,
                        'Incoming call',
                        vehicle ? `Incoming call regarding ${vehicle.vehicleNumber}` : 'Incoming call about your vehicle',
                        { type: 'call', interactionId },
                    );
                })().catch((err) => logger.error('call push failed', { error: err.message }));
            } else {
                // Owner calling back: scanner sits in the interaction room.
                socket.to(`interaction:${interactionId}`).emit('callMade', callPayload);
            }

            // Call marker in chat history (best effort — a lost race with
            // resolve must not kill signaling).
            messageService.sendMessage({
                interactionId,
                senderRole: identity.role,
                text: 'Voice call',
                type: MESSAGE_TYPE.CALL,
                asOwnerUserId: identity.role === SENDER_ROLE.OWNER ? identity.userId : null,
            }).catch(() => {});
        } catch (error) {
            logger.error('callUser failed', { error: error?.en || error?.message });
            emitError(socket, error);
        }
    });

    socket.on('answerCall', async (data = {}) => {
        try {
            const interaction = await resolveCallContext(data.interactionId);
            const { interactionId } = interaction;
            if (identity.role === SENDER_ROLE.OWNER) {
                // Server-side join removes the join_room→answer race for owners
                // answering from outside the chat screen.
                socket.join(`interaction:${interactionId}`);
                pendingCallStore.remove(identity.userId); // picked up — drop the buffer
            }
            socket.to(`interaction:${interactionId}`).emit('callAccepted', {
                signal: data.signal,
                interactionId,
            });
        } catch (error) {
            emitError(socket, error);
        }
    });

    socket.on('iceCandidate', (data = {}) => {
        const { candidate } = data;
        if (!candidate) return;
        const interactionId = identity.role === SENDER_ROLE.SCANNER
            ? identity.interactionId
            : data.interactionId;
        // Membership == authorization (joined via handshake, join_room,
        // callUser or answerCall — all ownership-checked).
        if (interactionId && socket.rooms.has(`interaction:${interactionId}`)) {
            socket.to(`interaction:${interactionId}`).emit('iceCandidate', { candidate, interactionId });
        }
    });

    socket.on('endCall', (data = {}) => {
        const interactionId = identity.role === SENDER_ROLE.SCANNER
            ? identity.interactionId
            : data.interactionId;
        if (!interactionId || !socket.rooms.has(`interaction:${interactionId}`)) return;

        if (identity.role === SENDER_ROLE.SCANNER) {
            if (socket.data.ownerUserId) pendingCallStore.remove(socket.data.ownerUserId); // cancelled pre-pickup
        } else {
            pendingCallStore.remove(identity.userId);
        }
        socket.to(`interaction:${interactionId}`).emit('callEnded', { interactionId });
        // Scanner-initiated calls buffered for the owner also die on user-room level:
        if (identity.role === SENDER_ROLE.SCANNER && socket.data.ownerUserId) {
            io.to(`user:${socket.data.ownerUserId}`).emit('callEnded', { interactionId });
        }
    });
};
