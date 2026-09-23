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

// WebRTC signaling relay. The scanner always calls the owner; identity comes
// from the socket, target rooms are derived server-side — clients never
// address arbitrary users.
module.exports = (io, socket) => {
    const { identity } = socket.data;

    // Scanner → owner: initiate call.
    socket.on('callUser', async (data = {}) => {
        try {
            if (identity.role !== SENDER_ROLE.SCANNER) return emitError(socket, errorCodes.NOT_OWNER);
            const { interactionId } = identity;

            const interaction = await interactionService.getByInteractionId(interactionId);
            if (!interaction) return emitError(socket, errorCodes.INTERACTION_NOT_FOUND);
            if (interaction.status !== INTERACTION_STATUS.ACTIVE) {
                return emitError(socket, errorCodes.SESSION_ENDED);
            }
            if (interaction.scanner?.phoneNumber
                && await userService.isBlocked(interaction.userId, interaction.scanner.phoneNumber)) {
                return emitError(socket, errorCodes.BLOCKED_BY_OWNER);
            }

            const ownerUserId = interaction.userId;
            socket.data.ownerUserId = ownerUserId; // cached for ice/end relays

            await interactionService.setContactType(interactionId, CONTACT_TYPE.CALL);

            const callPayload = {
                signal: data.signalData,
                interactionId,
                name: data.name || interaction.scanner?.name || 'Scanner',
            };

            // 1. Live delivery + 2. buffer for a reconnecting device.
            io.to(`user:${ownerUserId}`).emit('callMade', callPayload);
            pendingCallStore.set(ownerUserId, callPayload);

            // 3. Push notification (fire-and-forget).
            (async () => {
                const owner = await userService.getWithPushToken(ownerUserId);
                if (!owner?.pushToken || !owner.notificationPreferences?.pushEnabled) return;
                const vehicle = await vehicleService.getByVehicleId(interaction.vehicleId);
                await notificationService.sendPushNotification(
                    owner.pushToken,
                    'Incoming call',
                    vehicle ? `Incoming call regarding ${vehicle.vehicleNumber}` : 'Incoming call about your vehicle',
                    { type: 'call', interactionId },
                );
            })().catch((err) => logger.error('call push failed', { error: err.message }));

            // 4. Call marker in the chat history (best effort — an already-ended
            // race here must not kill the signaling).
            messageService.sendMessage({
                interactionId,
                senderRole: SENDER_ROLE.SCANNER,
                text: 'Voice call',
                type: MESSAGE_TYPE.CALL,
            }).catch(() => {});
        } catch (error) {
            logger.error('callUser failed', { error: error.message });
            emitError(socket, error);
        }
    });

    // Owner answers: relay into the interaction room (scanner is auto-joined).
    socket.on('answerCall', (data = {}) => {
        if (identity.role !== SENDER_ROLE.OWNER) return;
        const { interactionId, signal } = data;
        if (!interactionId || !socket.rooms.has(`interaction:${interactionId}`)) {
            return emitError(socket, errorCodes.NOT_OWNER);
        }
        pendingCallStore.remove(identity.userId); // call picked up — drop the buffer
        socket.to(`interaction:${interactionId}`).emit('callAccepted', { signal, interactionId });
    });

    socket.on('iceCandidate', (data = {}) => {
        const { candidate } = data;
        if (!candidate) return;
        if (identity.role === SENDER_ROLE.SCANNER) {
            const ownerUserId = socket.data.ownerUserId;
            if (ownerUserId) io.to(`user:${ownerUserId}`).emit('iceCandidate', { candidate, interactionId: identity.interactionId });
        } else {
            const { interactionId } = data;
            if (interactionId && socket.rooms.has(`interaction:${interactionId}`)) {
                socket.to(`interaction:${interactionId}`).emit('iceCandidate', { candidate, interactionId });
            }
        }
    });

    socket.on('endCall', (data = {}) => {
        if (identity.role === SENDER_ROLE.SCANNER) {
            const ownerUserId = socket.data.ownerUserId;
            if (ownerUserId) {
                io.to(`user:${ownerUserId}`).emit('callEnded', { interactionId: identity.interactionId });
                pendingCallStore.remove(ownerUserId); // cancelled before pickup
            }
        } else {
            const { interactionId } = data;
            pendingCallStore.remove(identity.userId);
            if (interactionId && socket.rooms.has(`interaction:${interactionId}`)) {
                socket.to(`interaction:${interactionId}`).emit('callEnded', { interactionId });
            }
        }
    });
};
