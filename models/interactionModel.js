const mongoose = require('mongoose');
const {
    INTERACTION_STATUS,
    CONTACT_TYPE,
    SENDER_ROLE,
    MESSAGE_TYPE,
    MESSAGE_MAX_LENGTH,
} = require('../constants/interaction');

const messageSchema = new mongoose.Schema({
    messageId: { type: String, required: true },
    senderRole: { type: String, enum: Object.values(SENDER_ROLE), required: true },
    text: { type: String, required: true, maxlength: MESSAGE_MAX_LENGTH },
    type: { type: String, enum: Object.values(MESSAGE_TYPE), default: MESSAGE_TYPE.TEXT },
    timestamp: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false },
}, { _id: false });

const interactionSchema = new mongoose.Schema({
    interactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },   // vehicle owner
    vehicleId: { type: String, required: true, index: true },

    type: { type: String, default: 'Scan', maxlength: 100 }, // reason, e.g. "Wrong Parking"
    contactType: { type: String, enum: Object.values(CONTACT_TYPE), default: CONTACT_TYPE.SCAN },
    status: { type: String, enum: Object.values(INTERACTION_STATUS), default: INTERACTION_STATUS.ACTIVE },
    resolvedAt: { type: Date },

    // Scanner identity + minimal capture context. Deliberately no device
    // fingerprinting (screen/timezone/ISP) — DPDP data-minimization.
    scanner: {
        phoneNumber: { type: String }, // E.164, OTP-verified at interaction create
        phoneVerified: { type: Boolean, default: false },
        name: { type: String, maxlength: 100 },
        ip: { type: String },
        userAgent: { type: String, maxlength: 300 },
        capturedAt: { type: Date },
    },

    location: {
        latitude: { type: Number },
        longitude: { type: Number },
    },

    messages: [messageSchema],
    lastMessage: { type: String, maxlength: MESSAGE_MAX_LENGTH },
    unreadCount: { type: Number, default: 0 }, // scanner messages the owner hasn't read
}, {
    timestamps: true,
});

// Owner history list: newest first, filtered by owner.
interactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Interaction', interactionSchema);
