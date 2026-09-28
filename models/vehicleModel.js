const mongoose = require('mongoose');
const { VEHICLE_TYPES } = require('../constants/vehicles');

const vehicleSchema = new mongoose.Schema({
    vehicleId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },

    vehicleName: { type: String, required: true, trim: true, maxlength: 100 },
    vehicleNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    vehicleType: { type: String, enum: VEHICLE_TYPES, default: 'Other' },
    notes: { type: String, maxlength: 500 },

    // The QR payload — https://…/scan/{tagId}. Unique: one tag, one vehicle.
    tagId: { type: String, required: true, unique: true },
    qrCodeUrl: { type: String },

    // Short sticker code (QR print kit, feature 07): scan.…/t/{code} — six
    // no-lookalike chars keep the printed QR at V3/EC-H. Sparse: legacy docs
    // get one from the backfill script. Rotates together with the tagId.
    shortCode: { type: String, unique: true, sparse: true, uppercase: true },

    // Optional vehicle-level emergency contact override (owner's profile
    // emergencyContact is the default). Never exposed unless privacy allows.
    emergencyContactNumber: { type: String },

    isActive: { type: Boolean, default: true },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Vehicle', vehicleSchema);
