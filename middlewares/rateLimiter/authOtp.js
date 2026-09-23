const config = require('../../config/config');
const errorCodes = require('../../config/errorCodes');
const { handleError } = require('../../utils/requestHandlers');
const logger = require('../../utils/logger');
const { makeLimiter, limiterMiddleware } = require('./common');

// Dual-layer protection on OTP endpoints (runs after phone normalization):
//  - per IP:    10 requests / 5 min  (blanket abuse)
//  - per phone:  3 requests / 5 min  (targeting one number / SMS bombing)
const ipLimiter = makeLimiter({ keyPrefix: 'rl_otp_ip', points: 10, duration: 300, blockDuration: 300 });
const phoneLimiter = makeLimiter({ keyPrefix: 'rl_otp_phone', points: 3, duration: 300, blockDuration: 300 });
// Resend cooldown: one send per phone per cooldown window (send-otp only).
const cooldownLimiter = makeLimiter({
    keyPrefix: 'rl_otp_cooldown',
    points: 1,
    duration: config.otp.resendCooldownSeconds,
});

const ipMiddleware = limiterMiddleware(ipLimiter, (req) => req.ip);
const phoneMiddleware = limiterMiddleware(phoneLimiter, (req) => req.body.phoneNumber);

exports.authOtpLimiter = [ipMiddleware, phoneMiddleware];

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
