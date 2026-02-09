require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { initSocket } = require('./socket');

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


// Initialize Socket.IO
const io = initSocket(server);

// Import models for socket handlers
const { Interaction, User, Vehicle } = require('./db');
const { sendPushNotification } = require('./utils/notifications');
const mongoose = require('mongoose');

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join user's personal room for global updates (new scans, messages)
    // userId already contains "user_" prefix, use directly as room name
    socket.on('join_user_room', (userId) => {
        socket.join(userId);
        console.log(`Socket ${socket.id} joined user room: ${userId}`);
    });

    // Leave user room (on logout or disconnect)
    socket.on('leave_user_room', (userId) => {
        socket.leave(userId);
        console.log(`Socket ${socket.id} left user room: ${userId}`);
    });

    // Join a specific interaction room (for chat)
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

            // Only allow messages if status is active, or if scanner is reactivating a resolved session
            if (interaction.status !== 'active') {
                if (senderId === 'scanner' && ['resolved', 'ignored', 'reported'].includes(interaction.status)) {
                    interaction.status = 'active';
                    interaction.resolvedAt = undefined;
                    // Emit status update to owner so they know it's active again
                    io.to(interactionId).emit('status_update', {
                        interactionId,
                        status: 'active'
                    });
                } else {
                    socket.emit('error', { message: 'Chat session has ended' });
                    return;
                }
            }

            // Update contactType to 'chat' on first message (was 'scan')
            const isFirstMessage = interaction.messages.length === 0;
            if (isFirstMessage && interaction.contactType === 'scan') {
                interaction.contactType = 'chat';
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

            // Broadcast message to all clients in the chat room
            io.to(interactionId).emit('receive_message', newMessage);
            console.log(`Message sent in room ${interactionId}:`, text);

            // Emit update to owner's global user room for real-time list updates
            const userId = interaction.userId;
            io.to(userId).emit('interaction_update', {
                interactionId: interaction.interactionId,
                contactType: interaction.contactType,
                lastMessage: interaction.lastMessage,
                status: interaction.status,
                message: newMessage // Include full message for sync
            });
            console.log(`Emitted interaction_update to ${userId} for ${interactionId}`);

            // Send Push Notification
            // Only send push to owner if scanner sends message
            if (senderId === 'scanner') {
                try {
                    const interactionData = await Interaction.findOne({ interactionId });
                    if (interactionData) {
                        const user = await User.findOne({ userId: interactionData.userId });
                        const vehicle = await Vehicle.findOne({ vehicleId: interactionData.vehicleId });

                        if (user && user.pushToken && user.notificationPreferences.chatMessages) {
                            const title = `New Message from ${vehicle ? vehicle.vehicleNumber : 'Tag Scanner'}`;
                            await sendPushNotification(
                                user.pushToken,
                                title,
                                text,
                                { interactionId, type: 'new_message' }
                            );
                        }
                    }
                } catch (error) {
                    console.error("Error sending message push:", error);
                }
            }

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
                interaction.resolvedAt = new Date();
                await interaction.save();

                // Broadcast to all clients in the room
                io.to(interactionId).emit('session_ended', {
                    status: 'resolved',
                    endedBy
                });
                console.log(`Session ended (resolved) in room ${interactionId} by ${endedBy}`);

                // Emit status update to owner's global room
                if (interaction.userId) {
                    io.to(interaction.userId).emit('interaction_update', {
                        interactionId: interaction.interactionId,
                        status: 'resolved'
                    });
                }
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

        // Emit status update to owner's global room
        // Need to find interaction first to get userId
        try {
            const interaction = await Interaction.findOne({ interactionId });
            if (interaction && interaction.userId) {
                interaction.status = 'reported'; // Update status in memory just for emission if needed, though usually handled by API
                // Note: The API likely handles the DB update for report, but socket emits the event

                io.to(interaction.userId).emit('interaction_update', {
                    interactionId: interactionId,
                    status: 'reported'
                });
            }
        } catch (error) {
            console.error('Error broadcasting report status:', error);
        }
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
