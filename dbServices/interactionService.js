const Model = require('../models/interactionModel');
const { generateInteractionId } = require('../utils/ids');
const { INTERACTION_STATUS, CONTACT_TYPE, SENDER_ROLE } = require('../constants/interaction');

// List projection: history views never carry full message arrays.
const LIST_PROJECTION = {
    interactionId: 1,
    userId: 1,
    vehicleId: 1,
    type: 1,
    contactType: 1,
    status: 1,
    resolvedAt: 1,
    'scanner.phoneNumber': 1,
    'scanner.name': 1,
    location: 1,
    lastMessage: 1,
    unreadCount: 1,
    createdAt: 1,
    updatedAt: 1,
};

exports.create = async (data) => {
    const interaction = await Model.create({
        ...data,
        interactionId: generateInteractionId(),
    });
    return interaction.toObject();
};

exports.getByInteractionId = (interactionId) => Model.findOne({ interactionId }).lean();

exports.listByUser = async (userId, { page = 1, limit = 20, status } = {}) => {
    const query = { userId, ...(status && { status }) };
    const skip = (Math.max(+page, 1) - 1) * +limit;
    const [items, totalCount] = await Promise.all([
        Model.find(query, LIST_PROJECTION).sort({ createdAt: -1 }).skip(skip).limit(+limit).lean(),
        Model.countDocuments(query),
    ]);
    return { items, totalCount, page: +page, totalPages: Math.ceil(totalCount / +limit) || 1 };
};

exports.updateStatus = (interactionId, status) => Model.findOneAndUpdate(
    { interactionId },
    {
        $set: {
            status,
            ...(status === INTERACTION_STATUS.RESOLVED ? { resolvedAt: new Date() } : {}),
        },
        ...(status === INTERACTION_STATUS.ACTIVE ? { $unset: { resolvedAt: 1 } } : {}),
    },
    { new: true, lean: true, runValidators: true },
);

/**
 * Atomic message append — the filter enforces the active-session rule, so a
 * resolved/reported session can never gain messages, and concurrent sends
 * can't lose each other (no read-modify-write).
 * Returns the updated doc, or null when the session isn't active.
 */
exports.pushMessageIfActive = async (interactionId, message) => {
    const updated = await Model.findOneAndUpdate(
        { interactionId, status: INTERACTION_STATUS.ACTIVE },
        {
            $push: { messages: message },
            $set: { lastMessage: message.text },
            ...(message.senderRole === SENDER_ROLE.SCANNER ? { $inc: { unreadCount: 1 } } : {}),
        },
        { new: true, lean: true, projection: { messages: 0 } },
    );
    if (updated && updated.contactType === CONTACT_TYPE.SCAN && message.type === 'text') {
        // First real message upgrades the interaction from a bare scan to a chat.
        await Model.updateOne(
            { interactionId, contactType: CONTACT_TYPE.SCAN },
            { $set: { contactType: CONTACT_TYPE.CHAT } },
        );
        updated.contactType = CONTACT_TYPE.CHAT;
    }
    return updated;
};

exports.setContactType = (interactionId, contactType) => Model.updateOne(
    { interactionId },
    { $set: { contactType } },
);

exports.markRead = (interactionId) => Model.findOneAndUpdate(
    { interactionId },
    {
        $set: {
            unreadCount: 0,
            'messages.$[m].isRead': true,
        },
    },
    {
        arrayFilters: [{ 'm.isRead': false }],
        new: true,
        lean: true,
        projection: { unreadCount: 1, interactionId: 1 },
    },
);

exports.remove = (interactionId) => Model.findOneAndDelete({ interactionId }).lean();

exports.removeAllByUser = async (userId) => {
    const interactions = await Model.find({ userId }).lean();
    if (interactions.length) await Model.deleteMany({ userId });
    return interactions;
};

exports.removeAllByVehicle = async (vehicleId) => {
    const interactions = await Model.find({ vehicleId }).lean();
    if (interactions.length) await Model.deleteMany({ vehicleId });
    return interactions;
};
