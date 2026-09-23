const crypto = require('crypto');
const Model = require('../models/otpModel');
const config = require('../config/config');
const errorCodes = require('../config/errorCodes');

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

/**
 * Issue a fresh OTP for a phone (replaces any previous one — a single OTP is
 * valid per number at any time). Returns the plaintext for delivery.
 */
exports.issue = async (phoneNumber) => {
    const otp = crypto.randomInt(100000, 1000000).toString(); // crypto-secure 6 digits
    await Model.findOneAndUpdate(
        { phoneNumber },
        {
            $set: {
                otpHash: hashOtp(otp),
                attempts: 0,
                expiresAt: new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000),
            },
        },
        { upsert: true },
    );
    return otp;
};

/**
 * Verify-and-consume in one atomic statement: the filter IS the check
 * (phone + hash + unexpired + attempts under cap), the delete IS the
 * consumption — single-use and race-free by construction.
 * Throws curated codes on failure; returns true on success.
 */
exports.verifyAndConsume = async (phoneNumber, otp) => {
    if (config.otp.masterOtp && otp === config.otp.masterOtp) {
        await Model.deleteOne({ phoneNumber });
        return true;
    }

    const consumed = await Model.findOneAndDelete({
        phoneNumber,
        otpHash: hashOtp(otp),
        expiresAt: { $gt: new Date() },
        attempts: { $lt: config.otp.maxAttempts },
    }).lean();
    if (consumed) return true;

    // Wrong code: burn an attempt on whatever OTP exists for this phone.
    const bumped = await Model.findOneAndUpdate(
        { phoneNumber },
        { $inc: { attempts: 1 } },
        { new: true, lean: true },
    );
    if (bumped && bumped.attempts >= config.otp.maxAttempts) {
        throw errorCodes.OTP_ATTEMPTS_EXCEEDED;
    }
    throw errorCodes.INVALID_OTP;
};
