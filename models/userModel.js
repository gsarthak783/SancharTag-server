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
    pushToken: { type: String, select: false },

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
            _id: false,
        }],
        select: false,
    },
}, {
    timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
