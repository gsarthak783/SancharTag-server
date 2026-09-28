const mongoose = require('mongoose');

// One row per user × channel × logical send. The unique dedupe index IS the
// idempotency barrier: retries, crashed workers and double-fired events all
// collapse into a single delivery.
const deliverySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    channel: { type: String, enum: ['push', 'inapp', 'whatsapp', 'sms'], required: true },
    eventKey: { type: String },     // transactional/lifecycle event name
    templateKey: { type: String },  // campaigns (phase C)
    campaignId: { type: String },
    dedupeKey: { type: String, required: true },

    status: {
        type: String,
        enum: ['queued', 'sent', 'delivered', 'read', 'failed',
            'suppressed_capped', 'suppressed_optout', 'suppressed_quiet'],
        default: 'queued',
    },
    // Expo push tickets: { id, token } pairs — the receipts poller resolves
    // them to delivered/failed ~15-30min later (send ≠ outcome).
    tickets: {
        type: [{ id: String, token: String, _id: false }],
        default: undefined,
    },
    error: { type: String },
    sentAt: { type: Date },
    resolvedAt: { type: Date }, // when receipts settled the outcome
}, {
    timestamps: true,
});

deliverySchema.index({ userId: 1, channel: 1, dedupeKey: 1 }, { unique: true });
// The receipts poller scans this: push sends awaiting receipt resolution.
deliverySchema.index({ channel: 1, status: 1, sentAt: 1 });

module.exports = mongoose.model('Delivery', deliverySchema);
