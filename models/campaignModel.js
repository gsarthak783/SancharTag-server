const mongoose = require('mongoose');

// An admin-authored send (feature 02, phase C): template × audience ×
// schedule, with live stats. The runner claims due campaigns atomically via
// the state machine, so two server instances can't double-run one.
const campaignSchema = new mongoose.Schema({
    campaignId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    templateKey: { type: String, required: true },
    channels: { type: [String], default: ['push', 'inapp'] }, // whatsapp joins in phase D

    audience: {
        kind: { type: String, enum: ['preset', 'query', 'static'], required: true },
        preset: { type: String }, // see campaignService.AUDIENCE_PRESETS
        query: { type: Object },  // raw find on users — superadmin only, sanitized
        userIds: { type: [String], default: undefined },
    },

    schedule: {
        kind: { type: String, enum: ['now', 'once', 'recurring'], required: true },
        at: { type: Date },      // once
        cron: { type: String },  // recurring (server timezone)
    },
    nextRunAt: { type: Date },   // the runner's queue key

    state: {
        type: String,
        enum: ['draft', 'scheduled', 'running', 'done', 'paused', 'cancelled'],
        default: 'draft',
    },
    throttlePerMin: { type: Number, default: 600 },

    stats: {
        targeted: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        suppressed: { type: Number, default: 0 },
        noTokens: { type: Number, default: 0 },
    },
    lastRunAt: { type: Date },
    lastError: { type: String },
    createdBy: { type: String },
}, {
    timestamps: true,
});

campaignSchema.index({ state: 1, nextRunAt: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
