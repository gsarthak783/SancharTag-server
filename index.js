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
app.use('/auth', require('./routes/authRoutes'));

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

        // Check for pending calls
        if (global.pendingCalls && global.pendingCalls.has(userId)) {
            const call = global.pendingCalls.get(userId);
            // Check if expired (e.g., 30 seconds)
            if (Date.now() - call.timestamp < 30000) {
                console.log(`Emitting buffered call to ${userId}`);
                socket.emit("callMade", {
                    signal: call.signal,
                    from: call.from,
                    name: call.name
                });
            } else {
                global.pendingCalls.delete(userId);
            }
        }
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

            // STRICT SESSION CONTROL: Only allow messages if status is active
            if (interaction.status !== 'active') {
                socket.emit('error', { message: 'Session has ended. You cannot send more messages.' });
                return;
            }

            // Check if blocked
            if (senderId === 'scanner') {
                // In a real scenario, we might need to look up the scanner's phone number from the interaction or session
                // But interaction schema stores scanner details.
                if (interaction.scanner && interaction.scanner.phoneNumber) {
                    const user = await User.findOne({ userId: interaction.userId });
                    // Check if blocked (schema is array of objects { phoneNumber, name })
                    if (user && user.blockedNumbers && user.blockedNumbers.some(entry => entry.phoneNumber === interaction.scanner.phoneNumber)) {
                        socket.emit('error', { message: 'You have been blocked by this user.' });
                        return;
                    }
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
                type: 'text',
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


    // WebRTC Signaling Events

    // Store pending calls: userId -> { signal, from, name, timestamp, vehicleNumber }
    // Using a simple object/map outside string scope would be better but declaring here for scope access if needed, 
    // actually 'pendingCalls' should be global to module.
    // I will use a static map attached to the socket object or a global variable.
    // Let's use a global variable at the top of the file/module scope in a real app, 
    // but here I'll attach it to the 'io' object for persistence across connections? 
    // No, 'io' is global.

    // Let's assume 'pendingCalls' is defined at module level. I'll add it there.

    socket.on("callUser", async (data) => {
        const { userToCall, signalData, from, name, vehicleNumber, interactionId } = data;

        console.log(`Call initiated by ${from} to ${userToCall}`);

        // Update Interaction Status if interactionId is provided
        if (interactionId) {
            try {
                const interaction = await Interaction.findOne({ interactionId });
                if (interaction) {
                    // STRICT SESSION CONTROL: Block call if not active
                    if (interaction.status !== 'active') {
                        socket.emit('error', { message: 'Session has ended. You cannot make calls.' });
                        return;
                    }

                    // Check if blocked
                    if (interaction.scanner && interaction.scanner.phoneNumber) {
                        const user = await User.findOne({ userId: interaction.userId });
                        // Check if blocked (schema is array of objects { phoneNumber, name })
                        if (user && user.blockedNumbers && user.blockedNumbers.some(entry => entry.phoneNumber === interaction.scanner.phoneNumber)) {
                            socket.emit('error', { message: 'You have been blocked by this user.' });
                            return;
                        }
                    }

                    interaction.contactType = 'call';
                    await interaction.save();

                    // Emit update to owner
                    io.to(userToCall).emit('interaction_update', {
                        interactionId,
                        contactType: 'call',
                        status: 'active'
                    });
                } else {
                    // Interaction not found but ID provided?
                    console.warn(`Interaction ${interactionId} not found during call attempt`);
                }
            } catch (error) {
                console.error("Error updating interaction on call start:", error);
                // Should we block the call if error? 
                // Currently proceeding, but maybe we should block.
            }
        }

        // 1. Emit to online devices immediately
        io.to(userToCall).emit("callMade", { signal: signalData, from, name });

        // 2. Buffer the call for reconnecting devices (pending logic)
        // Store in a global map (need to define it)
        global.pendingCalls = global.pendingCalls || new Map();
        global.pendingCalls.set(userToCall, {
            signal: signalData,
            from,
            name,
            timestamp: Date.now()
        });

        // 3. Send Push Notification
        try {
            const user = await User.findOne({ userId: userToCall });
            if (user && user.pushToken) {
                const title = "Incoming Call";
                const body = vehicleNumber
                    ? `Incoming call regarding ${vehicleNumber}`
                    : `Incoming call from ${name}`;

                await sendPushNotification(user.pushToken, title, body, {
                    type: 'call',
                    from,
                    vehicleNumber
                });
                console.log(`Sent call push notification to ${user.name} (${userToCall})`);
            }
        } catch (error) {
            console.error("Error sending call notification:", error);
        }

        // 4. Log the call in chat history
        try {
            const interaction = await Interaction.findOne({ interactionId });
            if (interaction) {
                const callMessage = {
                    messageId: new mongoose.Types.ObjectId().toString(),
                    senderId: 'scanner',
                    text: 'Voice Call Initiated',
                    type: 'call',
                    timestamp: new Date(),
                    isRead: false
                };

                interaction.messages.push(callMessage);
                interaction.lastMessage = 'Voice Call';
                await interaction.save();

                // Emit signal to update chat UI immediately
                io.to(interactionId).emit('receive_message', callMessage);
            }
        } catch (error) {
            console.error("Error logging call message:", error);
        }

    });

    socket.on("answerCall", (data) => {
        io.to(data.to).emit("callAccepted", data.signal);
        console.log(`Call accepted by ${socket.id}, signal sent to ${data.to}`);
    });

    socket.on("iceCandidate", (data) => {
        const { to, candidate } = data;
        io.to(to).emit("iceCandidate", { candidate, from: socket.id });
        // console.log(`ICE candidate exchanged between ${socket.id} and ${to}`);
    });

    socket.on("endCall", async (data) => {
        const { to, interactionId } = data; // scanner passes interactionId if available
        io.to(to).emit("callEnded");
        console.log(`Call ended by ${socket.id}`);

        if (interactionId) {
            // We do NOT auto-resolve on endCall anymore per user request.
            // Just notify that call ended.
        }

        // Remove from pending calls if exists
        if (global.pendingCalls && global.pendingCalls.has(to)) {
            console.log(`Removing pending call for ${to} as it was ended/cancelled`);
            global.pendingCalls.delete(to);
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
