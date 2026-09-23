/**
 * Allowlist field picker — the mass-assignment guard. Request bodies are
 * reduced to explicitly writable keys before they reach any update.
 * Keys prefixed with `$` are always dropped (Mongo operator injection).
 */
const pick = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return {};
    return keys.reduce((acc, key) => {
        if (Object.prototype.hasOwnProperty.call(obj, key) && !key.startsWith('$')) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
};

module.exports = { pick };
