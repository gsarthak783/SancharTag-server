const Model = require('../models/vehicleModel');
const { generateVehicleId, generateTagId } = require('../utils/ids');

exports.getByTagId = (tagId) => Model.findOne({ tagId }).lean();

exports.getByVehicleId = (vehicleId) => Model.findOne({ vehicleId }).lean();

exports.listByUser = (userId) => Model.find({ userId }).sort({ createdAt: -1 }).lean();

exports.countByUser = (userId) => Model.countDocuments({ userId });

// IDs are server-generated here — clients never supply them.
exports.create = async (userId, data) => {
    const vehicle = await Model.create({
        ...data,
        userId,
        vehicleId: generateVehicleId(),
        tagId: generateTagId(),
    });
    return vehicle.toObject();
};

// `updates` MUST already be allowlist-picked by the caller.
exports.update = (vehicleId, updates) => Model.findOneAndUpdate(
    { vehicleId },
    { $set: updates },
    { new: true, lean: true, runValidators: true },
);

exports.remove = (vehicleId) => Model.findOneAndDelete({ vehicleId }).lean();

// --- Console (internal admin API) ---

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.searchVehicles = async ({ search = '', page = 1, limit = 20 } = {}) => {
    const query = search
        ? {
            $or: [
                { vehicleNumber: { $regex: escapeRegex(search), $options: 'i' } },
                { tagId: search },
                { vehicleId: search },
                { userId: search },
            ],
        }
        : {};
    const skip = (Math.max(+page, 1) - 1) * +limit;
    const [items, totalCount] = await Promise.all([
        Model.find(query).sort({ createdAt: -1 }).skip(skip).limit(+limit).lean(),
        Model.countDocuments(query),
    ]);
    return { items, totalCount, page: +page, totalPages: Math.ceil(totalCount / +limit) || 1 };
};

exports.setActive = (vehicleId, isActive) => Model.findOneAndUpdate(
    { vehicleId },
    { $set: { isActive } },
    { new: true, lean: true },
);

// Compromised/misused sticker: issue a fresh tagId — the old QR dies instantly.
exports.regenerateTag = (vehicleId) => Model.findOneAndUpdate(
    { vehicleId },
    { $set: { tagId: generateTagId() } },
    { new: true, lean: true },
);

exports.countAll = () => Model.countDocuments({});

// Cascade support: return the docs (for archiving) then delete them.
exports.removeAllByUser = async (userId) => {
    const vehicles = await Model.find({ userId }).lean();
    if (vehicles.length) await Model.deleteMany({ userId });
    return vehicles;
};
