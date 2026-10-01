const Model = require('../models/chatMessageModel');
const { generateMessageId } = require('../utils/ids');

exports.findByClient = (conversationId, senderRole, clientId) =>
    Model.findOne({ conversationId, senderRole, clientId }).lean();

// Insert; a duplicate clientId (parallel retry) returns the existing row —
// the unique index is what turns at-least-once delivery into exactly-once.
exports.insert = async ({ conversationId, senderRole, clientId, seq, text, type, replyTo, media }) => {
    try {
        const doc = await Model.create({
            messageId: generateMessageId(),
            conversationId,
            senderRole,
            clientId,
            seq,
            text,
            type,
            ...(replyTo && { replyTo }),
            ...(media && { media }),
        });
        return { message: doc.toObject(), duplicate: false };
    } catch (err) {
        if (err?.code === 11000) {
            const existing = await exports.findByClient(conversationId, senderRole, clientId);
            if (existing) return { message: existing, duplicate: true };
        }
        throw err;
    }
};

// Seq-cursor pagination, newest page first, returned ascending for render.
exports.listPage = async (conversationId, { beforeSeq, limit = 40 } = {}) => {
    const query = {
        conversationId,
        deletedAt: null,
        ...(beforeSeq ? { seq: { $lt: +beforeSeq } } : {}),
    };
    const items = await Model.find(query).sort({ seq: -1 }).limit(Math.min(+limit, 100)).lean();
    return items.reverse();
};

// Reconnect sync: everything after the client's high-water mark.
exports.listSince = (conversationId, sinceSeq, limit = 100) =>
    Model.find({ conversationId, seq: { $gt: +sinceSeq || 0 }, deletedAt: null })
        .sort({ seq: 1 }).limit(limit).lean();

// Frozen evidence for reports / archives (oldest first, capped).
exports.listForSnapshot = (conversationId, cap = 200) =>
    Model.find({ conversationId }).sort({ seq: 1 }).limit(cap).lean();

exports.countAfter = (conversationId, senderRole, afterSeq) =>
    Model.countDocuments({ conversationId, senderRole, seq: { $gt: +afterSeq || 0 } });

exports.removeAllByConversation = (conversationId) =>
    Model.deleteMany({ conversationId });

exports.removeAllByConversations = (conversationIds) =>
    Model.deleteMany({ conversationId: { $in: conversationIds } });
