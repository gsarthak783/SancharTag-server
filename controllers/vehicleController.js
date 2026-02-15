const asyncHandler = require('express-async-handler');
const { Vehicle, User } = require('../db');

// @desc    Get vehicles (supports query by tagId)
// @route   GET /vehicles
// @access  Public
const getVehicles = asyncHandler(async (req, res) => {
    const { tagId, vehicleId } = req.query;
    let query = {};

    if (tagId) {
        query.tagId = tagId;
    }

    if (vehicleId) {
        query.vehicleId = vehicleId;
    }

    const vehicles = await Vehicle.find(query).lean();

    // Enrich with user privacy settings and emergency contact
    // Also filter out if the requester (scannerPhoneNumber) is blocked
    const { scannerPhoneNumber } = req.query;

    const enrichedVehicles = await Promise.all(vehicles.map(async (vehicle) => {
        const user = await User.findOne({ userId: vehicle.userId }).lean();

        // Check if scanner is blocked by this owner
        if (scannerPhoneNumber && user?.blockedNumbers?.some(entry => entry.phoneNumber === scannerPhoneNumber)) {
            // If blocked, return a special flag or null, or handle at the route level
            // Since we're mapping, let's mark it.
            return {
                ...vehicle,
                isBlocked: true, // Frontend should handle this
                vehicleNumber: 'BLOCKED', // Mask data
                ownerName: 'BLOCKED',
                notes: 'You have been blocked by this user.'
            };
        }

        return {
            ...vehicle,
            showEmergencyContact: user?.privacySettings?.showEmergencyContact ?? true,
            emergencyContact: user?.emergencyContact // Fetch directly from User profile
        };
    }));

    res.json(enrichedVehicles);
});

// @desc    Create a vehicle
// @route   POST /vehicles
// @access  Public
const createVehicle = asyncHandler(async (req, res) => {
    const { vehicleId, userId, vehicleName, vehicleNumber, vehicleType, notes, tagId, ownerName, ownerContactNumber, qrCodeUrl } = req.body;

    if (!vehicleId || !userId || !vehicleNumber) {
        res.status(400);
        throw new Error('Please add all required fields');
    }

    // Check if vehicle exists
    const vehicleExists = await Vehicle.findOne({ vehicleId });

    if (vehicleExists) {
        res.status(400);
        throw new Error('Vehicle already exists');
    }

    const vehicle = await Vehicle.create({
        vehicleId,
        userId,
        vehicleName,
        vehicleNumber,
        vehicleType,
        notes,
        tagId,
        ownerName,
        ownerContactNumber,
        qrCodeUrl
    });

    if (vehicle) {
        res.status(201).json(vehicle);
    } else {
        res.status(400);
        throw new Error('Invalid vehicle data');
    }
});

// @desc    Update vehicle
// @route   PATCH /vehicles/:id
// @access  Public
const updateVehicle = asyncHandler(async (req, res) => {
    const vehicleId = req.params.id; // Custom vehicleId

    const vehicle = await Vehicle.findOne({ vehicleId });

    if (!vehicle) {
        res.status(404);
        throw new Error('Vehicle not found');
    }

    const updatedVehicle = await Vehicle.findOneAndUpdate({ vehicleId }, req.body, {
        new: true,
    });

    res.json(updatedVehicle);
});

// @desc    Delete vehicle
// @route   DELETE /vehicles/:id
// @access  Public
const deleteVehicle = asyncHandler(async (req, res) => {
    const vehicleId = req.params.id;
    const vehicle = await Vehicle.findOne({ vehicleId });

    if (!vehicle) {
        res.status(404);
        throw new Error('Vehicle not found');
    }

    await vehicle.deleteOne();

    res.json({ id: vehicleId });
});

module.exports = {
    getVehicles,
    createVehicle,
    updateVehicle,
    deleteVehicle,
};
