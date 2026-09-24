const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const interactionService = require('../dbServices/interactionService');
const reportService = require('../dbServices/reportService');
const otpService = require('../dbServices/otpService');
const accountService = require('../services/accountService');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
const { handleResponse, handleError } = require('../utils/requestHandlers');
const { normalizePhone } = require('../utils/phone');
const { clearOtpLimits, getOtpLimitStatus } = require('../middlewares/rateLimiter/authOtp');
const { INTERACTION_STATUS } = require('../constants/interaction');

// Internal admin surface — called ONLY by the SancharTag Console's server
// (adminInternalAuth guards every route). The console owns admin identity,
// 2FA and audit; this surface owns the data operations.

exports.stats = async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [users, newUsers7d, vehicles, interactions, activeInteractions, scansToday, openReports] = await Promise.all([
            userService.countAll(),
            userService.countSince(weekAgo),
            vehicleService.countAll(),
            interactionService.countAll(),
            interactionService.countByStatus(INTERACTION_STATUS.ACTIVE),
            interactionService.countSince(startOfDay),
            reportService.countByStatus('open'),
        ]);
        handleResponse({ res, data: { users, newUsers7d, vehicles, interactions, activeInteractions, scansToday, openReports } });
    } catch (error) {
        handleError({ res, error });
    }
};

// --- Users ---

exports.listUsers = async (req, res) => {
    try {
        const { search, page, limit } = req.query;
        handleResponse({ res, data: await userService.searchUsers({ search, page, limit }) });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.getUser = async (req, res) => {
    try {
        const user = await userService.getByUserId(req.params.userId);
        if (!user) throw errorCodes.USER_NOT_FOUND;
        const [vehicles, interactionCounts, blocked] = await Promise.all([
            vehicleService.listByUser(user.userId),
            interactionService.countsForUser(user.userId),
            userService.getBlockedNumbers(user.userId),
        ]);
        handleResponse({
            res,
            data: { user, vehicles, interactionCounts, blockedCount: (blocked || []).length },
        });
    } catch (error) {
        handleError({ res, error });
    }
};

// Suspension also rotates the salt: every session dies, and auth middleware
// rejects the account until unsuspended.
exports.suspendUser = async (req, res) => {
    try {
        const user = await userService.setStatus(req.params.userId, 'suspended');
        if (!user) throw errorCodes.USER_NOT_FOUND;
        await userService.rotateSalt(user.userId);
        handleResponse({ res, message: 'User suspended', data: user });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.unsuspendUser = async (req, res) => {
    try {
        const user = await userService.setStatus(req.params.userId, 'active');
        if (!user) throw errorCodes.USER_NOT_FOUND;
        handleResponse({ res, message: 'User unsuspended', data: user });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.forceLogout = async (req, res) => {
    try {
        const user = await userService.getByUserId(req.params.userId);
        if (!user) throw errorCodes.USER_NOT_FOUND;
        await userService.rotateSalt(user.userId);
        handleResponse({ res, message: 'All sessions revoked', data: { userId: user.userId } });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const result = await accountService.deleteUserCascade(
            req.params.userId,
            `console:${req.actingAdmin}`,
        );
        handleResponse({ res, message: 'Account deleted', data: result });
    } catch (error) {
        handleError({ res, error });
    }
};

// --- Vehicles / tags ---

exports.listVehicles = async (req, res) => {
    try {
        const { search, page, limit } = req.query;
        handleResponse({ res, data: await vehicleService.searchVehicles({ search, page, limit }) });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.setVehicleActive = (isActive) => async (req, res) => {
    try {
        const vehicle = await vehicleService.setActive(req.params.vehicleId, isActive);
        if (!vehicle) throw errorCodes.VEHICLE_NOT_FOUND;
        handleResponse({ res, message: isActive ? 'Tag reactivated' : 'Tag deactivated', data: vehicle });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.regenerateTag = async (req, res) => {
    try {
        const vehicle = await vehicleService.regenerateTag(req.params.vehicleId);
        if (!vehicle) throw errorCodes.VEHICLE_NOT_FOUND;
        handleResponse({ res, message: 'Tag regenerated — the old QR is dead', data: vehicle });
    } catch (error) {
        handleError({ res, error });
    }
};

// --- Reports (moderation queue) ---

exports.listReports = async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        handleResponse({ res, data: await reportService.queue({ status, page, limit }) });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.getReport = async (req, res) => {
    try {
        const report = await reportService.getByReportId(req.params.reportId);
        if (!report) throw errorCodes.REPORT_NOT_FOUND;
        handleResponse({ res, data: report });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.setReportStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['open', 'reviewed', 'actioned'].includes(status)) throw errorCodes.INVALID_STATUS;
        const report = await reportService.setStatus(req.params.reportId, status);
        if (!report) throw errorCodes.REPORT_NOT_FOUND;
        handleResponse({ res, data: report });
    } catch (error) {
        handleError({ res, error });
    }
};

// --- Interactions (support debugging: metadata only, never chat contents) ---

exports.getInteractionMeta = async (req, res) => {
    try {
        const interaction = await interactionService.getByInteractionId(req.params.interactionId);
        if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;
        const { messages, ...meta } = interaction;
        handleResponse({ res, data: { ...meta, messageCount: (messages || []).length } });
    } catch (error) {
        handleError({ res, error });
    }
};

/**
 * PRIVACY UNLOCK — the one sanctioned window into a non-reported chat.
 * The console gates this behind superadmin + step-up + a mandatory reason;
 * this side refuses without a reason and writes a loud log line so the
 * access is traceable on BOTH systems.
 */
exports.unlockInteractionMessages = async (req, res) => {
    try {
        const reason = String(req.query.reason || '').trim();
        if (reason.length < 10) throw errorCodes.VALIDATION_FAILED;

        const interaction = await interactionService.getByInteractionId(req.params.interactionId);
        if (!interaction) throw errorCodes.INTERACTION_NOT_FOUND;

        logger.warn('PRIVACY UNLOCK: interaction messages accessed', {
            interactionId: interaction.interactionId,
            actingAdmin: req.actingAdmin,
            reason,
        });

        handleResponse({
            res,
            data: {
                interactionId: interaction.interactionId,
                status: interaction.status,
                scanner: interaction.scanner,
                messages: interaction.messages || [],
            },
        });
    } catch (error) {
        handleError({ res, error });
    }
};

// --- Support tools ---

exports.otpStatus = async (req, res) => {
    try {
        const phoneNumber = normalizePhone(String(req.query.phoneNumber || ''));
        if (!phoneNumber) throw errorCodes.PHONE_REQUIRED;
        const [otp, limits] = await Promise.all([
            otpService.status(phoneNumber),
            getOtpLimitStatus(phoneNumber),
        ]);
        handleResponse({ res, data: { phoneNumber, otp, limits } });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.clearRateLimit = async (req, res) => {
    try {
        const phoneNumber = normalizePhone(String(req.body.phoneNumber || ''));
        if (!phoneNumber) throw errorCodes.PHONE_REQUIRED;
        await clearOtpLimits(phoneNumber);
        logger.info('support: OTP rate limits cleared', { phoneNumber, actingAdmin: req.actingAdmin });
        handleResponse({ res, message: 'Rate limits cleared', data: { phoneNumber } });
    } catch (error) {
        handleError({ res, error });
    }
};
