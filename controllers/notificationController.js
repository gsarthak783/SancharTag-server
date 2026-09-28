const notificationDbService = require('../dbServices/notificationDbService');
const { handleResponse, handleError } = require('../utils/requestHandlers');

exports.list = async (req, res) => {
    try {
        const { cursor, limit } = req.query;
        const [page, unreadCount] = await Promise.all([
            notificationDbService.listByUser(req.user.userId, { cursor, limit: limit || 20 }),
            notificationDbService.unreadCount(req.user.userId),
        ]);
        handleResponse({ res, data: { ...page, unreadCount } });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.markRead = async (req, res) => {
    try {
        await notificationDbService.markRead(req.user.userId, req.body.ids);
        const unreadCount = await notificationDbService.unreadCount(req.user.userId);
        handleResponse({ res, message: 'Marked read', data: { unreadCount } });
    } catch (error) {
        handleError({ res, error });
    }
};
