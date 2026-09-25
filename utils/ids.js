const crypto = require('crypto');

// Server-generated, non-enumerable IDs. Prefixes preserved from v1 so existing
// printed QR tags (tag_…) and stored references keep their shape.
const generateId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;

const generateUserId = () => generateId('user');
const generateVehicleId = () => generateId('veh');
const generateTagId = () => generateId('tag');
const generateInteractionId = () => generateId('int');
const generateMessageId = () => generateId('msg');
const generateReportId = () => generateId('rpt');
const generateTicketId = () => `TKT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

// Per-user JWT salt: rotating it invalidates every outstanding session token.
const generateJwtSalt = () => crypto.randomBytes(8).toString('hex');

module.exports = {
    generateId,
    generateUserId,
    generateVehicleId,
    generateTagId,
    generateInteractionId,
    generateMessageId,
    generateReportId,
    generateTicketId,
    generateJwtSalt,
};
