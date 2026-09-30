const mongoose = require('mongoose');
const { SENDER_ROLE, MESSAGE_TYPE, MESSAGE_MAX_LENGTH } = require('../constants/interaction');

// Chat v2 (feature 04): messages live in their own collection — the embedded
// array had a 16MB ceiling, full-doc rewrites and no pagination.
const chatMessageSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    conversationId: { type: String, required: true }, // = interactionId
    senderRole: { type: String, enum: Object.values(SENDER_ROLE), required: true },

    // Client-minted idempotency key: retries with the same clientId collapse
    // into one row via the unique index below (at-least-once → exactly-once).
    clientId: { type: String, required: true },
    // Per-conversation monotone counter ($inc on the interaction). Cursors,
    // pagination and reconnect sync all key off it. Gaps are possible when a
    // duplicate race burns a number — pagination is by presence, not
    // contiguity, so that's harmless.
    seq: { type: Number, required: true },

    type: { type: String, enum: Object.values(MESSAGE_TYPE), default: MESSAGE_TYPE.TEXT },
    text: { type: String, required: true, maxlength: MESSAGE_MAX_LENGTH },

    // Denormalized quote — rendering a reply must not need a join.
    replyTo: {
        messageId: String,
        senderRole: String,
        snippet: { type: String, maxlength: 140 },
    },

    deletedAt: { type: Date, default: null },
}, {
    timestamps: true,
});

// Two-party chat with fixed roles: one row per sender-side clientId.
chatMessageSchema.index({ conversationId: 1, senderRole: 1, clientId: 1 }, { unique: true });
chatMessageSchema.index({ conversationId: 1, seq: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
