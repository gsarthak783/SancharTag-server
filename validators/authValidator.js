const { body } = require('express-validator');
const errorCodes = require('../config/errorCodes');
const { normalizePhone } = require('../utils/phone');

// Normalizes phoneNumber in place (E.164) — invalid numbers become null and
// fail the notEmpty check. Everything downstream sees canonical form.
const phoneChain = () => body('phoneNumber')
    .customSanitizer((value) => normalizePhone(value))
    .notEmpty().withMessage(errorCodes.PHONE_REQUIRED);

exports.sendOtp = [phoneChain()];

exports.verifyOtp = [
    phoneChain(),
    body('otp')
        .isString().withMessage(errorCodes.INVALID_OTP)
        .trim()
        .isLength({ min: 4, max: 8 }).withMessage(errorCodes.INVALID_OTP),
];
