const mongoose = require('mongoose');

// Feature 09: platform-level trust. Verified phones make cross-owner
// patterns reliable — one owner blocking you is a dispute; three distinct
// owners is a signal the platform must act on.

const trustEventSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true }, // E.164, OTP-verified
    kind: {
        type: String,
        enum: ['blocked_by_owner', 'reported', 'report_upheld', 'interaction_flood'],
        required: true,
    },
    ownerUserId: { type: String },
    interactionId: { type: String },
}, { timestamps: true });

trustEventSchema.index({ phoneNumber: 1, createdAt: -1 });

const platformRestrictionSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    // watch: console queue only. restricted: scanner verification refused.
    // banned: manual only — the rules engine never downgrades and never bans.
    level: { type: String, enum: ['watch', 'restricted', 'banned'], required: true },
    reason: { type: String, maxlength: 500 },
    setBy: { type: String, default: 'system' }, // 'system' | acting admin id
    expiresAt: { type: Date },
    appealTicketId: { type: String },
}, { timestamps: true });

module.exports = {
    TrustEvent: mongoose.model('TrustEvent', trustEventSchema),
    PlatformRestriction: mongoose.model('PlatformRestriction', platformRestrictionSchema),
};
