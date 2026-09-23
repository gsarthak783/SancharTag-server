const { Server } = require('socket.io');
const config = require('../config/config');
const logger = require('../utils/logger');

let io = null;

const initSockets = (server) => {
    io = new Server(server, {
        cors: {
            origin: config.corsOrigins,
            methods: ['GET', 'POST'],
        },
        maxHttpBufferSize: 64 * 1024, // chat messages, not file uploads
    });

    // Handshake auth + event handlers land in Phase 4.
    io.on('connection', (socket) => {
        logger.debug('socket connected', { socketId: socket.id });
        socket.on('disconnect', () => {
            logger.debug('socket disconnected', { socketId: socket.id });
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized — call initSockets first');
    return io;
};

// Emit to an owner's personal room (rooms are joined server-side at handshake).
const emitToUser = (userId, event, data) => {
    if (io) io.to(`user:${userId}`).emit(event, data);
};

const emitToInteraction = (interactionId, event, data) => {
    if (io) io.to(`interaction:${interactionId}`).emit(event, data);
};

const closeSockets = () => new Promise((resolve) => {
    if (!io) return resolve();
    io.close(() => resolve());
});

module.exports = { initSockets, getIO, emitToUser, emitToInteraction, closeSockets };
