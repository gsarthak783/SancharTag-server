const Model = require('../models/notificationModel');

// Cursor pagination by _id (creation-ordered) — stable under new inserts,
// unlike page/skip.
exports.listByUser = async (userId, { cursor, limit = 20 } = {}) => {
    const query = { userId, ...(cursor && { _id: { $lt: cursor } }) };
    const items = await Model.find(query).sort({ _id: -1 }).limit(+limit).lean();
    return {
        items,
        nextCursor: items.length === +limit ? items[items.length - 1]._id.toString() : null,
    };
};

exports.unreadCount = (userId) => Model.countDocuments({ userId, readAt: null });

// ids omitted → mark everything read (the "mark all" affordance).
exports.markRead = (userId, ids) => Model.updateMany(
    { userId, readAt: null, ...(ids?.length && { _id: { $in: ids } }) },
    { $set: { readAt: new Date() } },
);
