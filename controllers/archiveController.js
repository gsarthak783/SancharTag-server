const asyncHandler = require('express-async-handler');
const { DeletedUser, DeletedVehicle, DeletedInteraction } = require('../db');

// @desc    Archive a user
// @route   POST /deletedUsers
// @access  Public
const archiveUser = asyncHandler(async (req, res) => {
    const deletedUser = await DeletedUser.create(req.body);
    res.status(201).json(deletedUser);
});

// @desc    Archive a vehicle
// @route   POST /deletedVehicles
// @access  Public
const archiveVehicle = asyncHandler(async (req, res) => {
    const deletedVehicle = await DeletedVehicle.create(req.body);
    res.status(201).json(deletedVehicle);
});

// @desc    Archive an interaction
// @route   POST /deletedInteractions
// @access  Public
const archiveInteraction = asyncHandler(async (req, res) => {
    const deletedInteraction = await DeletedInteraction.create(req.body);
    res.status(201).json(deletedInteraction);
});

module.exports = {
    archiveUser,
    archiveVehicle,
    archiveInteraction
};
