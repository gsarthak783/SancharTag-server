const crypto = require('crypto');
const config = require('../config/config');
const errorCodes = require('../config/errorCodes');
const { handleError } = require('../utils/requestHandlers');

const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const aHash = crypto.createHash('sha256').update(a).digest();
    const bHash = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(aHash, bHash);
};

/**
 * Server-to-server guard for the /admin surface. The SancharTag Console (the
 * only caller) holds ADMIN_INTERNAL_KEY on ITS server side — the key never
 * reaches a browser. The console authenticates its own admins (sessions, 2FA)
 * and forwards the acting admin's id for our request logs.
 * With no key configured, the whole surface is switched off.
 */
module.exports = (req, res, next) => {
    try {
        if (!config.adminInternalKey) throw errorCodes.ADMIN_DISABLED;
        const presented = req.headers['x-admin-key'];
        if (!safeEqual(presented, config.adminInternalKey)) throw errorCodes.ADMIN_UNAUTHORIZED;
        req.actingAdmin = String(req.headers['x-acting-admin'] || 'unknown').slice(0, 100);
        next();
    } catch (error) {
        handleError({ res, error });
    }
};
