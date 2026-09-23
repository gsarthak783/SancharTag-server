const config = require('../config/config');
const logger = require('../utils/logger');

const maskPhone = (phone) => `${String(phone).slice(0, 3)}****${String(phone).slice(-2)}`;

/**
 * SMS delivery seam. Provider integration (MSG91/Twilio) lands here later —
 * callers never change. With SMS disabled the OTP is surfaced through the API
 * response instead (dev only, config.otp.exposeOtpInResponse).
 * The OTP itself is never logged.
 */
const sendOtp = async (phoneNumber, otp) => {
    if (!config.otp.smsEnabled) {
        logger.info('SMS disabled — OTP delivery skipped', { phone: maskPhone(phoneNumber) });
        return { delivered: false };
    }
    // TODO(provider): MSG91/Twilio integration goes here.
    logger.error('SMS_ENABLED=true but no SMS provider is integrated');
    throw new Error('SMS provider not configured');
};

module.exports = { sendOtp };
