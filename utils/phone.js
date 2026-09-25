const { parsePhoneNumberFromString } = require('libphonenumber-js');
const config = require('../config/config');

/**
 * Normalize any user-supplied phone string to E.164 (+91XXXXXXXXXX).
 * Returns null when the number is not valid — callers treat that as a 422.
 * All storage, lookups and block comparisons use this canonical form.
 */
const normalizePhone = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const parsed = parsePhoneNumberFromString(raw.trim(), config.defaultPhoneRegion);
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number;
};

module.exports = { normalizePhone };
