const asyncHandler = require('express-async-handler');
const { Interaction } = require('../db');

// @desc    Get interactions (supports query by userId)
// @route   GET /interactions
// @access  Public
const getInteractions = asyncHandler(async (req, res) => {
    const { userId } = req.query;
    let query = {};

    if (userId) {
        query.userId = userId;
    }

    const interactions = await Interaction.find(query);
    res.json(interactions);
});

// @desc    Create an interaction
// @route   POST /interactions
// @access  Public
const createInteraction = asyncHandler(async (req, res) => {
    let { interactionId, userId, vehicleId, type, contactType, messages, lastMessage, scanner } = req.body;

    // Defaults
    type = type || 'Scan';
    contactType = contactType || 'scan';

    if (!interactionId || !userId || !vehicleId) {
        res.status(400);
        throw new Error('Please add all required fields (interactionId, userId, vehicleId)');
    }

    // Capture IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Merge scanner details
    scanner = {
        ...scanner,
        ip: ip,
        capturedAt: new Date()
    };

    const interaction = await Interaction.create({
        interactionId,
        userId,
        vehicleId,
        type,
        contactType,
        messages,
        lastMessage,
        scanner
    });

    if (interaction) {
        res.status(201).json(interaction);
    } else {
        res.status(400);
        throw new Error('Invalid interaction data');
    }
});

// @desc    Update interaction
// @route   PATCH /interactions/:id
// @access  Public
const updateInteraction = asyncHandler(async (req, res) => {
    const interactionId = req.params.id;

    const interaction = await Interaction.findOne({ interactionId });

    if (!interaction) {
        res.status(404);
        throw new Error('Interaction not found');
    }

    const updatedInteraction = await Interaction.findOneAndUpdate({ interactionId }, req.body, {
        new: true,
    });

    res.json(updatedInteraction);
});


// @desc    Delete interaction
// @route   DELETE /interactions/:id
// @access  Public
const deleteInteraction = asyncHandler(async (req, res) => {
    const interactionId = req.params.id;
    const interaction = await Interaction.findOne({ interactionId });

    if (!interaction) {
        res.status(404);
        throw new Error('Interaction not found');
    }

    await interaction.deleteOne();

    res.json({ id: interactionId });
});

module.exports = {
    getInteractions,
    createInteraction,
    updateInteraction,
    deleteInteraction
};
