const mongoose = require('mongoose');

// One active OTP per phone number (unique) — issuing a new one replaces the old.
// OTPs are stored hashed; the plaintext exists only in the SMS (or dev response).
const otpSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true }, // E.164
    otpHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
}, {
    timestamps: true,
});

// Mongo TTL sweeper removes docs once expiresAt passes.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
