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

// Cascade support: return the docs (for archiving) then delete them.
exports.removeAllByUser = async (userId) => {
    const vehicles = await Model.find({ userId }).lean();
    if (vehicles.length) await Model.deleteMany({ userId });
    return vehicles;
};
