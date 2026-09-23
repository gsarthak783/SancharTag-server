const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const interactionService = require('../dbServices/interactionService');
const archiveService = require('../dbServices/archiveService');
const errorCodes = require('../config/errorCodes');
const { handleResponse, handleError } = require('../utils/requestHandlers');
const { pick } = require('../utils/pick');

// Writable profile fields — the mass-assignment boundary. phoneNumber, status,
// userId, jwtSalt are NOT here by design.
const PROFILE_WRITABLE_FIELDS = [
    'name', 'email', 'emergencyContact', 'bloodGroup',
    'notificationPreferences', 'privacySettings', 'acceptedPolicy',
];

exports.me = async (req, res) => {
    try {
        handleResponse({ res, data: req.user });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.updateMe = async (req, res) => {
    try {
        const updates = pick(req.body, PROFILE_WRITABLE_FIELDS);
        if (updates.acceptedPolicy === true) updates.policyAcceptedAt = new Date();

        // Push tokens dedupe across accounts — separate path.
        if (req.body.pushToken) {
            await userService.setPushToken(req.user.userId, req.body.pushToken);
        }

        const data = Object.keys(updates).length
            ? await userService.updateProfile(req.user.userId, updates)
            : req.user;
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

// Full account deletion: archive-then-delete cascade, server-side, one call.
exports.deleteMe = async (req, res) => {
    try {
        const { userId } = req.user;
        const userDoc = await userService.remove(userId);
        if (!userDoc) throw errorCodes.USER_NOT_FOUND;

        await archiveService.archiveUser(userDoc, userId);
        const vehicles = await vehicleService.removeAllByUser(userId);
        await archiveService.archiveVehicles(vehicles, userId);
        const interactions = await interactionService.removeAllByUser(userId);
        await archiveService.archiveInteractions(interactions, userId);

        handleResponse({ res, message: 'Account deleted', data: { deleted: true } });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.getBlocked = async (req, res) => {
    try {
        const data = await userService.getBlockedNumbers(req.user.userId);
        handleResponse({ res, data: data || [] });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.block = async ({ user, body: { phoneNumber, name } }, res) => {
    try {
        if (phoneNumber === user.phoneNumber) throw errorCodes.VALIDATION_FAILED;
        await userService.block(user.userId, { phoneNumber, name });
        const data = await userService.getBlockedNumbers(user.userId);
        handleResponse({ res, message: 'Number blocked', data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.unblock = async ({ user, params: { phoneNumber } }, res) => {
    try {
        await userService.unblock(user.userId, phoneNumber);
        const data = await userService.getBlockedNumbers(user.userId);
        handleResponse({ res, message: 'Number unblocked', data });
    } catch (error) {
        handleError({ res, error });
    }
};
