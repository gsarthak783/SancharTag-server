const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const { Interaction, DeletedInteraction } = require('../db');

// @desc    Get interactions (supports query by userId or interactionId)
// @route   GET /interactions
// @access  Public
const getInteractions = asyncHandler(async (req, res) => {
    const { userId, interactionId } = req.query;
    let query = {};

    if (userId) {
        query.userId = userId;
    }

    if (interactionId) {
        query.interactionId = interactionId;
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


// @desc    Add message to interaction
// @route   POST /interactions/:id/messages
// @access  Public
const addMessage = asyncHandler(async (req, res) => {
    const interactionId = req.params.id;
    const { text, senderId, messageId } = req.body;

    const interaction = await Interaction.findOne({ interactionId });

    if (!interaction) {
        res.status(404);
        throw new Error('Interaction not found');
    }

    const newMessage = {
        messageId: messageId || new mongoose.Types.ObjectId().toString(),
        senderId,
        text,
        timestamp: new Date(),
        isRead: false
    };

    interaction.messages.push(newMessage);
    interaction.lastMessage = text;

    await interaction.save();

    res.status(201).json(newMessage);
});

// @desc    Delete interaction (archives first)
// @route   DELETE /interactions/:id
// @access  Public
const deleteInteraction = asyncHandler(async (req, res) => {
    const interactionId = req.params.id;
    const interaction = await Interaction.findOne({ interactionId });

    if (!interaction) {
        res.status(404);
        throw new Error('Interaction not found');
    }

    // Archive before deleting
    await DeletedInteraction.create({
        ...interaction.toObject(),
        deletedAt: new Date()
    });

    await interaction.deleteOne();

    res.json({ id: interactionId, message: 'Interaction deleted and archived' });
});

module.exports = {
    getInteractions,
    createInteraction,
    updateInteraction,
    deleteInteraction,
    addMessage
};
