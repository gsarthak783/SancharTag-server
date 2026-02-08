const asyncHandler = require('express-async-handler');
const { Report, Interaction } = require('../db');

// @desc    Create a report
// @route   POST /reports
// @access  Public
const createReport = asyncHandler(async (req, res) => {
    const { interactionId, reportedBy, category, description } = req.body;

    if (!interactionId || !reportedBy || !category) {
        res.status(400);
        throw new Error('Please provide interactionId, reportedBy, and category');
    }

    // Find the interaction
    const interaction = await Interaction.findOne({ interactionId });
    if (!interaction) {
        res.status(404);
        throw new Error('Interaction not found');
    }

    // Generate IDs
    const reportId = `rpt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;

    // Create report with interaction snapshot
    const report = await Report.create({
        reportId,
        ticketId,
        interactionId,
        reportedBy,
        category,
        description: description || '',
        interactionSnapshot: interaction.toObject()
    });

    // Update interaction status to 'reported'
    interaction.status = 'reported';
    await interaction.save();

    res.status(201).json({
        ...report.toObject(),
        message: 'Report created successfully'
    });
});

// @desc    Get reports
// @route   GET /reports
// @access  Public
const getReports = asyncHandler(async (req, res) => {
    const { interactionId, userId } = req.query;
    let query = {};

    if (interactionId) {
        query.interactionId = interactionId;
    }

    if (userId) {
        // Match reports where the interaction belonged to this user
        query['interactionSnapshot.userId'] = userId;
    }

    const reports = await Report.find(query).sort({ createdAt: -1 });
    res.json(reports);
});

module.exports = {
    createReport,
    getReports
};
