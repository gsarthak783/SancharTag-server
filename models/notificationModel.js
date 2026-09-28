const mongoose = require('mongoose');

// The in-app inbox (the bell). One doc per user-visible notification; push
// delivery bookkeeping lives in deliveryModel, not here.
const notificationSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    type: { type: String, required: true }, // event key: new_scan, new_message, lifecycle_no_vehicle…
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 500 },
    deepLink: { type: String }, // app route, e.g. /interaction/int_abc
    data: { type: Object },
    campaignId: { type: String },

    readAt: { type: Date, default: null },
    // Inbox entries expire — Mongo TTL reaps them (90d default set at insert).
    expiresAt: { type: Date, required: true },
}, {
    timestamps: true,
});

notificationSchema.index({ userId: 1, createdAt: -1 });
// Unread badge count is a hot path — partial index keeps it cheap.
notificationSchema.index(
    { userId: 1 },
    { partialFilterExpression: { readAt: null }, name: 'unread_by_user' },
);
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', notificationSchema);
