const mongoose = require('mongoose');

// Sensitive fields carry `select: false` — they never leave the DB layer unless
// a dbService opts in with .select('+field'). Backstop on top of projections.
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true, unique: true }, // E.164, normalized before write
    name: { type: String, trim: true, maxlength: 100 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },

    jwtSalt: { type: String, required: true, select: false },
    // Legacy single token — kept readable until every client registers via
    // POST /users/me/push-tokens; senders prefer expoTokens when present.
    pushToken: { type: String, select: false },

    // Multi-device push (notification engine, feature 02). Receipts polling
    // prunes DeviceNotRegistered entries; capped at 5 per user on write.
    expoTokens: {
        type: [{
            token: { type: String, required: true },
            deviceId: { type: String, required: true },
            platform: { type: String, enum: ['ios', 'android'], required: true },
            lastSeenAt: { type: Date, default: Date.now },
            _id: false,
        }],
        select: false,
    },

    // Denormalized engagement counters — lifecycle segments are plain finds
    // on these (e.g. { vehicleCount: 0, createdAt: { $lte: T-3d } }).
    vehicleCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
    lastScanAt: { type: Date },

    notificationPreferences: {
        pushEnabled: { type: Boolean, default: true },
        emailEnabled: { type: Boolean, default: true },
        smsEnabled: { type: Boolean, default: false },
        chatMessages: { type: Boolean, default: true },
        newScans: { type: Boolean, default: true },
        systemUpdates: { type: Boolean, default: true },
    },
    privacySettings: {
        showPhoneToScanner: { type: Boolean, default: false },
        showEmergencyContact: { type: Boolean, default: true },
        allowChatNotifications: { type: Boolean, default: true },
    },

    acceptedPolicy: { type: Boolean, default: false },
    policyAcceptedAt: { type: Date },
    emergencyContact: { type: String },
    bloodGroup: { type: String, maxlength: 5 },

    blockedNumbers: {
        type: [{
            phoneNumber: { type: String, required: true }, // E.164
            name: { type: String, default: 'Unknown' },
            // Block v2 context (feature 09): when and from which chat.
            blockedAt: { type: Date },
            sourceInteractionId: { type: String },
            _id: false,
        }],
        select: false,
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
