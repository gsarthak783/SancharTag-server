const { validationResult } = require('express-validator');
const { handleError } = require('../utils/requestHandlers');

// Collects express-validator results; responds with the first error.
// Error messages are curated errorCodes objects (carrying their own statusCode)
// or plain strings (default 422).
module.exports = (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    const first = errors.array()[0].msg;
    const statusCode = (first && typeof first === 'object' && first.statusCode) || 422;
    handleError({ res, error: first, statusCode });
};
