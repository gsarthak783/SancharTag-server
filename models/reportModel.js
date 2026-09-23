const mongoose = require('mongoose');
const { SENDER_ROLE } = require('../constants/interaction');

const reportSchema = new mongoose.Schema({
    reportId: { type: String, required: true, unique: true },
    ticketId: { type: String, required: true, unique: true },
    interactionId: { type: String, required: true },
    userId: { type: String, required: true, index: true }, // owner of the interaction

    reportedBy: { type: String, enum: Object.values(SENDER_ROLE), required: true },
    category: { type: String, required: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 2000 },

    // Frozen evidence — survives interaction deletion.
    interactionSnapshot: { type: Object },

    // Moderation workflow (admin tooling comes later; the state machine exists now).
    status: { type: String, enum: ['open', 'reviewed', 'actioned'], default: 'open' },
}, {
    timestamps: true,
});

// One report per interaction per side.
reportSchema.index({ interactionId: 1, reportedBy: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);
