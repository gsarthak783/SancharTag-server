const reportService = require('../dbServices/reportService');
const interactionService = require('../dbServices/interactionService');
const messageService = require('../services/messageService');
const errorCodes = require('../config/errorCodes');
const { handleResponse, handleError } = require('../utils/requestHandlers');
const { SENDER_ROLE, INTERACTION_STATUS } = require('../constants/interaction');

exports.create = async (req, res) => {
    try {
        const { interactionId, category, description } = req.body;

        const interaction = await interactionService.getByInteractionId(interactionId);
        if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;

        // Reporter role from identity; each side may report an interaction once.
        let reportedBy;
        if (req.user) {
            if (interaction.userId !== req.user.userId) throw errorCodes.NOT_OWNER;
            reportedBy = SENDER_ROLE.OWNER;
        } else {
            if (req.scanner.interactionId !== interactionId) throw errorCodes.INVALID_INTERACTION_TOKEN;
            reportedBy = SENDER_ROLE.SCANNER;
        }
        if (await reportService.existsFor(interactionId, reportedBy)) throw errorCodes.ALREADY_REPORTED;

        const report = await reportService.create({
            interactionId,
            userId: interaction.userId,
            reportedBy,
            category,
            description,
            interactionSnapshot: interaction, // frozen evidence
        });

        await messageService.updateStatusAndNotify({
            interactionId,
            status: INTERACTION_STATUS.REPORTED,
            endedBy: reportedBy,
        });

        const { interactionSnapshot, ...data } = report;
        handleResponse({ res, statusCode: 201, message: 'Report submitted', data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.list = async (req, res) => {
    try {
        const data = await reportService.listByUser(req.user.userId);
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};
