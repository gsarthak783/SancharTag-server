const config = require('../config/config');
const errorCodes = require('../config/errorCodes');
const otpService = require('../dbServices/otpService');
const userService = require('../dbServices/userService');
const smsService = require('../services/smsService');
const { generateSessionToken, generateScannerToken } = require('../utils/token');
const { handleResponse, handleError } = require('../utils/requestHandlers');

exports.sendOtp = async ({ body: { phoneNumber } }, res) => {
    try {
        const otp = await otpService.issue(phoneNumber);
        await smsService.sendOtp(phoneNumber, otp);
        handleResponse({
            res,
            message: 'OTP sent',
            data: {
                expiresInMinutes: config.otp.expiryMinutes,
                // Dev convenience only — exposeOtpInResponse is hard-off in production.
                ...(config.otp.exposeOtpInResponse && { otp }),
            },
        });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.verifyOtp = async ({ body: { phoneNumber, otp } }, res) => {
    try {
        await otpService.verifyAndConsume(phoneNumber, otp);

        const { user, isNewUser } = await userService.findOrCreateByPhone(phoneNumber);
        if (user.status === 'suspended') throw errorCodes.ACCOUNT_SUSPENDED;

        const token = generateSessionToken(user);
        const { jwtSalt, pushToken, blockedNumbers, ...safeUser } = user;

        handleResponse({
            res,
            message: isNewUser ? 'Account created' : 'Login successful',
            data: { isNewUser, user: safeUser, token },
        });
    } catch (error) {
        handleError({ res, error });
    }
};

/**
 * Scanner phone verification (accountability: scanners must prove a real
 * number before contacting an owner). Consumes the OTP like the owner flow
 * but creates NO account — it returns a 24h scanner token whose phone claim
 * is what interaction creation trusts.
 */
exports.verifyScannerOtp = async ({ body: { phoneNumber, otp } }, res) => {
    try {
        await otpService.verifyAndConsume(phoneNumber, otp);
        handleResponse({
            res,
            message: 'Phone verified',
            data: {
                scannerToken: generateScannerToken(phoneNumber),
                phoneNumber,
                expiresInDays: config.security.scannerTokenTtlDays,
            },
        });
    } catch (error) {
        handleError({ res, error });
    }
};

// Salt rotation invalidates every session token for this user, on all devices.
exports.logout = async ({ user: { userId } }, res) => {
    try {
        await userService.rotateSalt(userId);
        handleResponse({ res, message: 'Logged out', data: true });
    } catch (error) {
        handleError({ res, error });
    }
};
