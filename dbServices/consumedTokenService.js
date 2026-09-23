const Model = require('../models/consumedTokenModel');

/**
 * Atomically consume a single-use token id.
 * Returns true on first use, false if it was already consumed.
 */
exports.consume = async (jti, expSeconds) => {
    try {
        await Model.create({ jti, expiresAt: new Date(expSeconds * 1000) });
        return true;
    } catch (error) {
        if (error.code === 11000) return false;
        throw error;
    }
};
