const { body, param } = require('express-validator');
const errorCodes = require('../config/errorCodes');
const { normalizePhone } = require('../utils/phone');

exports.updateMe = [
    body('name').optional().isString().trim().isLength({ max: 100 }),
    body('email').optional().isEmail().withMessage(errorCodes.VALIDATION_FAILED).normalizeEmail(),
    body('bloodGroup').optional().isString().trim().isLength({ max: 5 }),
    body('emergencyContact').optional()
        .customSanitizer((value) => normalizePhone(value))
        .notEmpty().withMessage(errorCodes.PHONE_REQUIRED),
    body('notificationPreferences').optional().isObject(),
    body('privacySettings').optional().isObject(),
    body('acceptedPolicy').optional().isBoolean(),
    body('pushToken').optional().isString().isLength({ max: 200 }),
];

exports.registerPushToken = [
    body('token').isString().withMessage(errorCodes.VALIDATION_FAILED)
        .matches(/^ExponentPushToken\[.+\]$/).withMessage(errorCodes.VALIDATION_FAILED)
        .isLength({ max: 200 }).withMessage(errorCodes.VALIDATION_FAILED),
    body('deviceId').isString().withMessage(errorCodes.VALIDATION_FAILED)
        .trim().notEmpty().withMessage(errorCodes.VALIDATION_FAILED)
        .isLength({ max: 100 }).withMessage(errorCodes.VALIDATION_FAILED),
    body('platform').isIn(['ios', 'android']).withMessage(errorCodes.VALIDATION_FAILED),
];

exports.blockNumber = [
    body('phoneNumber')
        .customSanitizer((value) => normalizePhone(value))
        .notEmpty().withMessage(errorCodes.PHONE_REQUIRED),
    body('name').optional().isString().trim().isLength({ max: 100 }),
];

exports.unblockNumber = [
    param('phoneNumber')
        .customSanitizer((value) => normalizePhone(decodeURIComponent(value)))
        .notEmpty().withMessage(errorCodes.PHONE_REQUIRED),
];
