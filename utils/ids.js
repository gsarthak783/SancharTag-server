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

// Sticker QR short codes — 6 chars from a base32-style alphabet with no
// look-alikes (no 0/O, 1/I/L, U): dense uppercase alphanumeric QR encoding
// (fits V3 at EC-H) and unambiguous to type from a damaged sticker.
// 29^6 ≈ 594M — collisions are handled by the unique index + caller retry.
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const generateShortCode = () => Array.from(crypto.randomBytes(6))
    .map((byte) => SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length])
    .join('');

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
    generateShortCode,
};
