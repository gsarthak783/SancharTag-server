const { body } = require('express-validator');
const errorCodes = require('../config/errorCodes');
const { normalizePhone } = require('../utils/phone');
const { VEHICLE_TYPES } = require('../constants/vehicles');

const optionalFields = [
    body('vehicleType').optional().isIn(VEHICLE_TYPES).withMessage(errorCodes.VALIDATION_FAILED),
    body('notes').optional().isString().trim().isLength({ max: 500 }),
    body('emergencyContactNumber').optional()
        .customSanitizer((value) => normalizePhone(value))
        .notEmpty().withMessage(errorCodes.PHONE_REQUIRED),
    body('isActive').optional().isBoolean(),
];

exports.create = [
    body('vehicleName').isString().trim().notEmpty().withMessage(errorCodes.VALIDATION_FAILED).isLength({ max: 100 }),
    body('vehicleNumber').isString().trim().notEmpty().withMessage(errorCodes.VALIDATION_FAILED).isLength({ max: 20 }),
    ...optionalFields,
];

exports.update = [
    body('vehicleName').optional().isString().trim().notEmpty().isLength({ max: 100 }),
    body('vehicleNumber').optional().isString().trim().notEmpty().isLength({ max: 20 }),
    ...optionalFields,
];
