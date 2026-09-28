const { Server } = require('socket.io');
const config = require('../config/config');
const logger = require('../utils/logger');
const { verifyToken } = require('../utils/token');
const { TOKEN_PURPOSE } = require('../constants/tokens');
const { SENDER_ROLE } = require('../constants/interaction');
const userService = require('../dbServices/userService');
const pendingCallStore = require('../utils/pendingCallStore');

let io = null;

/**
 * Handshake auth — no unauthenticated sockets, no client-chosen rooms:
 *  - owner session JWT (salt-checked)      → joins  user:<userId>
 *  - interaction token (scanner, scoped)   → joins  interaction:<interactionId>
 * Room membership is established here or via authorized join_room only, so
 * handlers can treat membership as authorization.
 */
const authenticateSocket = async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('unauthorized'));

        let info;
        try {
            info = verifyToken(token);
        } catch (err) {
            return next(new Error('unauthorized'));
        }

        if (info.purpose === TOKEN_PURPOSE.INTERACTION) {
            socket.data.identity = {
                role: SENDER_ROLE.SCANNER,
                interactionId: info.interactionId,
                phoneNumber: info.phoneNumber || null,
            };
            return next();
        }

        if (!info.purpose) {
            const user = await userService.getAuthUser(info.userId);
            if (!user || user.status === 'suspended' || user.jwtSalt !== info.jwtSalt) {
                return next(new Error('unauthorized'));
            }
            socket.data.identity = { role: SENDER_ROLE.OWNER, userId: user.userId };
            return next();
        }

        return next(new Error('unauthorized')); // scan tokens etc. are not socket credentials
    } catch (error) {
        logger.error('socket auth failed', { error: error.message });
        return next(new Error('unauthorized'));
    }
};

const initSockets = (server) => {
    io = new Server(server, {
        cors: {
            origin: config.corsOrigins,
            methods: ['GET', 'POST'],
        },
        maxHttpBufferSize: 64 * 1024, // chat messages, not file uploads
    });

    io.use(authenticateSocket);

    io.on('connection', (socket) => {
        const { identity } = socket.data;

        if (identity.role === SENDER_ROLE.OWNER) {
            socket.join(`user:${identity.userId}`);
            // Replay a buffered incoming call for a device that reconnected mid-ring.
            const pendingCall = pendingCallStore.get(identity.userId);
            if (pendingCall) socket.emit('callMade', pendingCall);
        } else {
            socket.join(`interaction:${identity.interactionId}`);
        }

        require('./chatHandlers')(io, socket);
        require('./callHandlers')(io, socket);

        logger.debug('socket connected', { role: identity.role, socketId: socket.id });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized — call initSockets first');
    return io;
};

const emitToUser = (userId, event, data) => {
    if (io) io.to(`user:${userId}`).emit(event, data);
};

const emitToInteraction = (interactionId, event, data) => {
    if (io) io.to(`interaction:${interactionId}`).emit(event, data);
};

// True when one of the owner's sockets is inside the interaction room — i.e.
// that chat is literally on their screen (the app joins on chat open, leaves
// on close, and disconnects on background, so membership is a live signal).
const ownerInInteractionRoom = async (interactionId) => {
    if (!io) return false;
    const members = await io.in(`interaction:${interactionId}`).fetchSockets();
    return members.some((member) => member.data?.identity?.role === SENDER_ROLE.OWNER);
};

const closeSockets = () => new Promise((resolve) => {
    if (!io) return resolve();
    io.close(() => resolve());
});

module.exports = { initSockets, getIO, emitToUser, emitToInteraction, ownerInInteractionRoom, closeSockets };
