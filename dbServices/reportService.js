const Model = require('../models/reportModel');
const { generateReportId, generateTicketId } = require('../utils/ids');

exports.create = async ({ interactionId, userId, reportedBy, category, description, interactionSnapshot }) => {
    const report = await Model.create({
        reportId: generateReportId(),
        ticketId: generateTicketId(),
        interactionId,
        userId,
        reportedBy,
        category,
        description: description || '',
        interactionSnapshot,
    });
    return report.toObject();
};

// Owner-facing list: never include the snapshot (it holds scanner PII).
exports.listByUser = (userId) => Model.find(
    { userId },
    { interactionSnapshot: 0 },
).sort({ createdAt: -1 }).lean();

exports.existsFor = async (interactionId, reportedBy) => {
    const match = await Model.exists({ interactionId, reportedBy });
    return !!match;
};

// --- Console (internal admin API) ---

// Moderation queue — snapshots excluded from lists (PII; fetched per-report).
exports.queue = async ({ status, page = 1, limit = 20 } = {}) => {
    const query = status ? { status } : {};
    const skip = (Math.max(+page, 1) - 1) * +limit;
    const [items, totalCount] = await Promise.all([
        Model.find(query, { interactionSnapshot: 0 }).sort({ createdAt: -1 }).skip(skip).limit(+limit).lean(),
        Model.countDocuments(query),
    ]);
    return { items, totalCount, page: +page, totalPages: Math.ceil(totalCount / +limit) || 1 };
};

// Full report incl. the frozen interaction snapshot (the moderation evidence).
exports.getByReportId = (reportId) => Model.findOne({ reportId }).lean();

exports.setStatus = (reportId, status) => Model.findOneAndUpdate(
    { reportId },
    { $set: { status } },
    { new: true, lean: true, runValidators: true, projection: { interactionSnapshot: 0 } },
);

exports.countByStatus = (status) => Model.countDocuments({ status });
