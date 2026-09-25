const { body } = require('express-validator');
const errorCodes = require('../config/errorCodes');
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

// Scanner's interaction-create payload. Requires both tokens (checked by their
// middlewares). The phone comes from the scanner token — never from the body.
exports.createFromScan = [
    // withMessage binds to the PRECEDING check only — set it on both.
    body('scanToken')
        .isString().withMessage(errorCodes.INVALID_SCAN_TOKEN)
        .notEmpty().withMessage(errorCodes.INVALID_SCAN_TOKEN),
    body('scannerToken')
        .isString().withMessage(errorCodes.INVALID_SCANNER_TOKEN)
        .notEmpty().withMessage(errorCodes.INVALID_SCANNER_TOKEN),
    body('type').optional().isString().trim().isLength({ max: 100 }),
    body('name').optional().isString().trim().isLength({ max: 100 }),
    body('location').optional().isObject(),
    body('location.latitude').optional().isFloat({ min: -90, max: 90 }),
    body('location.longitude').optional().isFloat({ min: -180, max: 180 }),
];
