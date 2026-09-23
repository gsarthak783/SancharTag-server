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
