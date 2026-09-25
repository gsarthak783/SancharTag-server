const config = require('../../config/config');
const errorCodes = require('../../config/errorCodes');
const { handleError } = require('../../utils/requestHandlers');
const logger = require('../../utils/logger');
const { makeLimiter, limiterMiddleware } = require('./common');

// Dual-layer protection on OTP endpoints (runs after phone normalization):
//  - per IP:    10 requests / 5 min  (blanket abuse)
//  - per phone:  6 requests / 5 min  (send + a few verify attempts fit; SMS
//    cost is separately capped by the resend cooldown, and brute force by the
//    per-OTP attempt limit)
const ipLimiter = makeLimiter({ keyPrefix: 'rl_otp_ip', points: 10, duration: 300, blockDuration: 300 });
const phoneLimiter = makeLimiter({ keyPrefix: 'rl_otp_phone', points: 6, duration: 300, blockDuration: 300 });
// Resend cooldown: one send per phone per cooldown window (send-otp only).
const cooldownLimiter = makeLimiter({
    keyPrefix: 'rl_otp_cooldown',
    points: 1,
    duration: config.otp.resendCooldownSeconds,
});

const ipMiddleware = limiterMiddleware(ipLimiter, (req) => req.ip);
const phoneMiddleware = limiterMiddleware(phoneLimiter, (req) => req.body.phoneNumber);

exports.authOtpLimiter = [ipMiddleware, phoneMiddleware];

// --- Console support tools ---

// "My OTP isn't working" is the #1 support call: this clears the per-phone
// counters (the per-IP limiter is left alone — it protects against a different
// attacker and can't be safely cleared by phone).
exports.clearOtpLimits = async (phoneNumber) => {
    await Promise.all([
        phoneLimiter.delete(phoneNumber),
        cooldownLimiter.delete(phoneNumber),
    ]);
};

exports.getOtpLimitStatus = async (phoneNumber) => {
    const [phone, cooldown] = await Promise.all([
        phoneLimiter.get(phoneNumber),
        cooldownLimiter.get(phoneNumber),
    ]);
    return {
        phoneAttemptsUsed: phone?.consumedPoints ?? 0,
        phoneBlockedForSeconds: phone && phone.consumedPoints >= 6 ? Math.ceil(phone.msBeforeNext / 1000) : 0,
        resendCooldownSeconds: cooldown && cooldown.consumedPoints >= 1 ? Math.ceil(cooldown.msBeforeNext / 1000) : 0,
    };
};

exports.otpResendCooldown = async (req, res, next) => {
    try {
        await cooldownLimiter.consume(req.body.phoneNumber);
        next();
    } catch (rejection) {
        if (rejection instanceof Error) {
            logger.error('rate limiter store error (failing open)', { error: rejection.message });
            return next();
        }
        res.set('Retry-After', String(Math.ceil((rejection.msBeforeNext || 0) / 1000) || 1));
        handleError({ res, error: errorCodes.OTP_RESEND_TOO_SOON });
    }
};
