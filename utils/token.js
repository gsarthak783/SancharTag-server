const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/config');
const { TOKEN_PURPOSE } = require('../constants/tokens');

const DAY_SEC = 24 * 60 * 60;
// Consumer app: a token renews at most once a day (vs HT's 1h — dashboard-tuned).
const REFRESH_MIN_AGE_SEC = DAY_SEC;

const sign = (payload, expiresIn) => jwt.sign(payload, config.security.secret, { algorithm: 'HS512', expiresIn });

const verifyToken = (token) => jwt.verify(token, config.security.secret, { algorithms: ['HS512'] });

/**
 * Owner session token.
 *  - exp-iat  = idle life (30d default): dies if unused that long
 *  - sxp      = absolute session expiry (180d default): never extended by refresh
 *  - sid      = stable session id across renewals (audit/log correlation)
 *  - jwtSalt  = must match the user doc; rotating the salt revokes the session
 */
const generateSessionToken = (user) => {
    const sid = crypto.randomBytes(16).toString('hex');
    const sxp = Math.floor(Date.now() / 1000) + config.security.absoluteSessionDays * DAY_SEC;
    return sign(
        { userId: user.userId, jwtSalt: user.jwtSalt, sid, sxp },
        `${config.security.tokenIdleDays}d`,
    );
};

/**
 * Sliding renewal: once a token is older than min(half its life, 1 day),
 * re-issue with the same life — but never past the session's absolute expiry.
 * Renewing early is what makes the idle life a true idle timeout.
 * `force` skips the age gate (used right after a salt rotation).
 * Returns the new token, or null when no refresh is due/possible.
 */
const refreshIfDue = ({ info, user, force = false, now = Math.floor(Date.now() / 1000) }) => {
    if (!Number.isFinite(info?.exp) || !Number.isFinite(info?.iat)) return null;
    const life = info.exp - info.iat;
    if (life <= 0) return null;
    if (!force && now - info.iat < Math.min(Math.floor(life / 2), REFRESH_MIN_AGE_SEC)) return null;
    const sxp = Number.isFinite(info.sxp) ? info.sxp : info.iat + config.security.absoluteSessionDays * DAY_SEC;
    const remaining = sxp - now;
    if (remaining <= 0) return null;
    const sid = info.sid || crypto.randomBytes(16).toString('hex');
    return sign(
        { userId: info.userId, jwtSalt: user.jwtSalt, sid, sxp },
        `${Math.min(life, remaining)}s`,
    );
};

// Scanner step 1: short-lived, single-use (jti consumed at interaction create),
// bound to one tag.
const generateScanToken = (tagId) => sign(
    { purpose: TOKEN_PURPOSE.SCAN, tagId, jti: crypto.randomBytes(12).toString('hex') },
    `${config.security.scanTokenTtlMinutes}m`,
);

// Scanner phone verification: issued after OTP verify, reusable for days so a
// returning scanner isn't re-prompted. The phone claim is the VERIFIED
// number — interaction creation trusts this token, never a body field.
const generateScannerToken = (phoneNumber) => sign(
    { purpose: TOKEN_PURPOSE.SCANNER, phoneNumber },
    `${config.security.scannerTokenTtlDays}d`,
);

// Scanner step 2: authorizes messaging + socket join for exactly ONE interaction.
const generateInteractionToken = ({ interactionId, phoneNumber }) => sign(
    {
        purpose: TOKEN_PURPOSE.INTERACTION,
        interactionId,
        ...(phoneNumber && { phoneNumber }),
    },
    `${config.security.interactionTokenTtlHours}h`,
);

module.exports = {
    verifyToken,
    generateSessionToken,
    refreshIfDue,
    generateScanToken,
    generateScannerToken,
    generateInteractionToken,
};
