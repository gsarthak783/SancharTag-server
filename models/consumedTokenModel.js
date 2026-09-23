const mongoose = require('mongoose');

// Single-use token ledger (scan tokens). Inserting a jti consumes it; the
// unique index makes double-spend a duplicate-key error. TTL cleans up once
// the underlying JWT would have expired anyway.
const consumedTokenSchema = new mongoose.Schema({
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
}, {
    timestamps: true,
});

consumedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ConsumedToken', consumedTokenSchema);
