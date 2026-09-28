const mongoose = require('mongoose');

// Reusable notification content (feature 02, phase C). Campaigns reference
// templates by key; {{name}}-style variables interpolate per user at send
// time. The whatsapp block is schema-ready but inert until phase D.
const templateSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: ['transactional', 'lifecycle', 'campaign'], default: 'campaign' },
    channels: {
        push: { title: String, body: String, channelId: { type: String, default: 'default' } },
        inapp: { title: String, body: String, deepLink: String },
        whatsapp: { metaTemplateName: String, lang: String, varMap: Object },
    },
    variables: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    createdBy: { type: String },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Template', templateSchema);
