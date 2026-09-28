const Model = require('../models/vehicleModel');
const { generateVehicleId, generateTagId, generateShortCode } = require('../utils/ids');

// The unique sparse index is the real collision check — retry a few times
// rather than pre-querying (find-then-insert races).
const isDuplicateShortCode = (err) =>
    err?.code === 11000 && err?.keyPattern?.shortCode;

exports.getByTagId = (tagId) => Model.findOne({ tagId }).lean();

exports.getByShortCode = (shortCode) =>
    Model.findOne({ shortCode: String(shortCode).toUpperCase() }).lean();

exports.getByVehicleId = (vehicleId) => Model.findOne({ vehicleId }).lean();

exports.listByUser = (userId) => Model.find({ userId }).sort({ createdAt: -1 }).lean();

exports.countByUser = (userId) => Model.countDocuments({ userId });

// IDs are server-generated here — clients never supply them.
exports.create = async (userId, data) => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            const vehicle = await Model.create({
                ...data,
                userId,
                vehicleId: generateVehicleId(),
                tagId: generateTagId(),
                shortCode: generateShortCode(),
            });
            return vehicle.toObject();
        } catch (err) {
            if (!isDuplicateShortCode(err) || attempt >= 3) throw err;
        }
    }
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

// Compromised/misused sticker: issue a fresh tagId AND shortCode — both
// printed URLs die instantly.
exports.regenerateTag = async (vehicleId) => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await Model.findOneAndUpdate(
                { vehicleId },
                { $set: { tagId: generateTagId(), shortCode: generateShortCode() } },
                { new: true, lean: true },
            );
        } catch (err) {
            if (!isDuplicateShortCode(err) || attempt >= 3) throw err;
        }
    }
};

exports.countAll = () => Model.countDocuments({});

// Cascade support: return the docs (for archiving) then delete them.
exports.removeAllByUser = async (userId) => {
    const vehicles = await Model.find({ userId }).lean();
    if (vehicles.length) await Model.deleteMany({ userId });
    return vehicles;
};
