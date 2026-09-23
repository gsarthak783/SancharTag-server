const scanService = require('../services/scanService');
const { handleResponse, handleError } = require('../utils/requestHandlers');

exports.getScanView = async ({ params: { tagId } }, res) => {
    try {
        const data = await scanService.getScanView(tagId);
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.createInteraction = async (req, res) => {
    try {
        const data = await scanService.createInteraction({
            tagId: req.params.tagId,
            scanTokenInfo: req.scanTokenInfo, // set by authenticateScanToken
            body: req.body,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });
        handleResponse({ res, statusCode: 201, message: 'Interaction created', data });
    } catch (error) {
        handleError({ res, error });
    }
};
