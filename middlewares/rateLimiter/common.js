const mongoose = require('mongoose');
const { RateLimiterMongo } = require('rate-limiter-flexible');
const errorCodes = require('../../config/errorCodes');
const { handleError } = require('../../utils/requestHandlers');
const logger = require('../../utils/logger');

// Counters live in Mongo (rl_* collections on the main connection): shared
// across restarts and, later, across instances — no in-memory limiter.
const makeLimiter = ({ keyPrefix, points, duration, blockDuration = 0 }) => new RateLimiterMongo({
    storeClient: mongoose.connection,
    keyPrefix,
    points,
    duration,
    blockDuration,
});

/**
 * Wrap a limiter into middleware.
 *  - keyFn(req) picks what's being limited (IP, phone, interaction id).
 *  - Store errors fail OPEN (log + continue): rate limiting protects the
 *    service; its own outage must not become one.
 */
const limiterMiddleware = (limiter, keyFn) => async (req, res, next) => {
    try {
        await limiter.consume(keyFn(req));
        next();
    } catch (rejection) {
        if (rejection instanceof Error) {
            logger.error('rate limiter store error (failing open)', { error: rejection.message });
            return next();
        }
        res.set('Retry-After', String(Math.ceil((rejection.msBeforeNext || 0) / 1000) || 1));
        handleError({ res, error: errorCodes.RATE_LIMITED });
    }
};

module.exports = { makeLimiter, limiterMiddleware };
