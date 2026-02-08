const asyncHandler = require('express-async-handler');
const { Vehicle } = require('../db');

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

    const vehicles = await Vehicle.find(query);
    res.json(vehicles);
});

// @desc    Create a vehicle
// @route   POST /vehicles
// @access  Public
const createVehicle = asyncHandler(async (req, res) => {
    const { vehicleId, userId, vehicleName, vehicleNumber, vehicleType, notes, tagId, ownerName, ownerContactNumber, emergencyContactNumber, qrCodeUrl } = req.body;

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
        emergencyContactNumber,
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
