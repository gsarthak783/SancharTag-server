const { body } = require('express-validator');
const errorCodes = require('../config/errorCodes');
const { normalizePhone } = require('../utils/phone');
const { MESSAGE_MAX_LENGTH, OWNER_SETTABLE_STATUSES } = require('../constants/interaction');

exports.sendMessage = [
    body('text')
        .isString().withMessage(errorCodes.MESSAGE_TEXT_REQUIRED)
        .trim()
        .notEmpty().withMessage(errorCodes.MESSAGE_TEXT_REQUIRED)
        .isLength({ max: MESSAGE_MAX_LENGTH }).withMessage(errorCodes.MESSAGE_TOO_LONG),
];

exports.updateStatus = [
    body('status').isIn(OWNER_SETTABLE_STATUSES).withMessage(errorCodes.INVALID_STATUS),
];

// Scanner's interaction-create payload. Everything optional except the scan token
// (checked by authenticateScanToken); phone, if provided, must normalize.
exports.createFromScan = [
    body('scanToken').isString().notEmpty().withMessage(errorCodes.INVALID_SCAN_TOKEN),
    body('type').optional().isString().trim().isLength({ max: 100 }),
    body('name').optional().isString().trim().isLength({ max: 100 }),
    body('phoneNumber').optional()
        .customSanitizer((value) => normalizePhone(value))
        .notEmpty().withMessage(errorCodes.PHONE_REQUIRED),
    body('location').optional().isObject(),
    body('location.latitude').optional().isFloat({ min: -90, max: 90 }),
    body('location.longitude').optional().isFloat({ min: -180, max: 180 }),
];
