const { DeletedUser, DeletedVehicle, DeletedInteraction } = require('../models/archiveModels');

// The only writers to the archive collections. `deletedBy` records which
// authenticated identity triggered the cascade.
const stamp = (doc, deletedBy) => ({ ...doc, deletedAt: new Date(), deletedBy });

exports.archiveUser = (userDoc, deletedBy) => DeletedUser.create(stamp(userDoc, deletedBy));

exports.archiveVehicles = (vehicleDocs, deletedBy) => (
    vehicleDocs.length
        ? DeletedVehicle.insertMany(vehicleDocs.map((v) => stamp(v, deletedBy)))
        : Promise.resolve([])
);

// Chat v2: messages live in their own collection, so the archive re-embeds
// them (capped) into each frozen doc and then deletes the live rows — every
// interaction-deletion cascade flows through here, so this is the one place
// message cleanup can't be forgotten.
exports.archiveInteractions = async (interactionDocs, deletedBy) => {
    if (!interactionDocs.length) return [];
    const chatMessageService = require('./chatMessageService');
    const enriched = await Promise.all(interactionDocs.map(async (doc) => {
        if (doc.messages?.length) return doc; // unmigrated legacy doc
        const rows = await chatMessageService.listForSnapshot(doc.interactionId, 500);
        return {
            ...doc,
            messages: rows.map((r) => ({
                messageId: r.messageId,
                senderRole: r.senderRole,
                text: r.text,
                type: r.type,
                timestamp: r.createdAt,
                isRead: true,
            })),
        };
    }));
    const archived = await DeletedInteraction.insertMany(enriched.map((i) => stamp(i, deletedBy)));
    await chatMessageService.removeAllByConversations(interactionDocs.map((i) => i.interactionId));
    return archived;
};
