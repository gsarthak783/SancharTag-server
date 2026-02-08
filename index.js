require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");

const { connectDB } = require('./db');
const { errorHandler } = require('./middleware/errorMiddleware');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Connect to Database
connectDB();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Routes
app.use('/users', require('./routes/userRoutes'));
app.use('/vehicles', require('./routes/vehicleRoutes'));
app.use('/interactions', require('./routes/interactionRoutes'));
app.use('/reports', require('./routes/reportRoutes'));

// Archive Routes
app.use('/', require('./routes/archiveRoutes'));


const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Import Interaction model for socket handlers
const { Interaction } = require('./db');
const mongoose = require('mongoose');

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join a specific interaction room
    socket.on('join_room', (interactionId) => {
        socket.join(interactionId);
        console.log(`Socket ${socket.id} joined room: ${interactionId}`);
    });

    // Handle sending messages
    socket.on('send_message', async (data) => {
        const { interactionId, text, senderId } = data;

        try {
            const interaction = await Interaction.findOne({ interactionId });

            if (!interaction) {
                socket.emit('error', { message: 'Interaction not found' });
                return;
            }

            // Only allow messages if status is active
            if (interaction.status !== 'active') {
                socket.emit('error', { message: 'Chat session has ended' });
                return;
            }

            const newMessage = {
                messageId: new mongoose.Types.ObjectId().toString(),
                senderId,
                text,
                timestamp: new Date(),
                isRead: false
            };

            interaction.messages.push(newMessage);
            interaction.lastMessage = text;
            await interaction.save();

            // Broadcast message to all clients in the room
            io.to(interactionId).emit('receive_message', newMessage);
            console.log(`Message sent in room ${interactionId}:`, text);

        } catch (error) {
            console.error('Error saving message:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });

    // End session - mark as resolved
    socket.on('end_session', async (data) => {
        const { interactionId, endedBy } = data;

        try {
            const interaction = await Interaction.findOne({ interactionId });
            if (interaction && interaction.status === 'active') {
                interaction.status = 'resolved';
                await interaction.save();

                // Broadcast to all clients in the room
                io.to(interactionId).emit('session_ended', {
                    status: 'resolved',
                    endedBy
                });
                console.log(`Session ended (resolved) in room ${interactionId} by ${endedBy}`);
            }
        } catch (error) {
            console.error('Error ending session:', error);
            socket.emit('error', { message: 'Failed to end session' });
        }
    });

    // Report submitted - broadcast session ended
    socket.on('report_submitted', async (data) => {
        const { interactionId, reportedBy } = data;

        // Broadcast to all clients in the room
        io.to(interactionId).emit('session_ended', {
            status: 'reported',
            reportedBy
        });
        console.log(`Session reported in room ${interactionId} by ${reportedBy}`);
    });

    // Leave room
    socket.on('leave_room', (interactionId) => {
        socket.leave(interactionId);
        console.log(`Socket ${socket.id} left room: ${interactionId}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

app.get('/', (req, res) => {
    res.send('Sanchar Tag Backend is running!');
});

app.use(errorHandler);

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
