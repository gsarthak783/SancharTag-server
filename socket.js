const { Server } = require("socket.io");

let io = null;

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized! Call initSocket first.");
    }
    return io;
};

// Emit to a specific user's room
const emitToUser = (userId, event, data) => {
    if (io) {
        // userId already contains the "user_" prefix, use directly as room name
        io.to(userId).emit(event, data);
        console.log(`Emitted ${event} to ${userId}`);
    }
};

module.exports = { initSocket, getIO, emitToUser };
