const { body } = require('express-validator');
const errorCodes = require('../config/errorCodes');

exports.create = [
    body('interactionId').isString().trim().notEmpty().withMessage(errorCodes.VALIDATION_FAILED),
    body('category').isString().trim().notEmpty().withMessage(errorCodes.VALIDATION_FAILED).isLength({ max: 100 }),
    body('description').optional().isString().trim().isLength({ max: 2000 }),
];
