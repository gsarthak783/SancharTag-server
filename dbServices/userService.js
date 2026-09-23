const Model = require('../models/userModel');
const { generateUserId, generateJwtSalt } = require('../utils/ids');

// Reads are .lean(); sensitive fields (jwtSalt, pushToken, blockedNumbers) are
// select:false in the schema and only fetched here with explicit opt-in.

exports.getByUserId = (userId) => Model.findOne({ userId }).lean();

exports.getByPhone = (phoneNumber) => Model.findOne({ phoneNumber }).lean();

// Auth middleware needs the salt to validate tokens.
exports.getAuthUser = (userId) => Model.findOne({ userId }).select('+jwtSalt').lean();

// Used by notification senders only.
exports.getWithPushToken = (userId) => Model.findOne({ userId }).select('+pushToken').lean();

/**
 * The ONLY user-creation path (called from verify-otp).
 * Atomic upsert; tells the caller whether the user already existed.
 */
exports.findOrCreateByPhone = async (phoneNumber) => {
    const result = await Model.findOneAndUpdate(
        { phoneNumber },
        {
            $setOnInsert: {
                userId: generateUserId(),
                phoneNumber,
                jwtSalt: generateJwtSalt(),
            },
        },
        { upsert: true, new: true, lean: true, includeResultMetadata: true },
    );
    const user = result.value;
    const isNewUser = !result.lastErrorObject?.updatedExisting;
    delete user.jwtSalt; // findOneAndUpdate bypasses select:false defaults on upsert paths
    return { user, isNewUser };
};

// `updates` MUST already be allowlist-picked by the caller.
exports.updateProfile = (userId, updates) => Model.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, lean: true, runValidators: true },
);

// Rotating the salt invalidates every outstanding session token (logout, suspension).
exports.rotateSalt = (userId) => Model.updateOne(
    { userId },
    { $set: { jwtSalt: generateJwtSalt() } },
);

// A push token identifies one device — strip it from any other account first.
exports.setPushToken = async (userId, pushToken) => {
    await Model.updateMany(
        { pushToken, userId: { $ne: userId } },
        { $unset: { pushToken: 1 } },
    );
    return Model.updateOne({ userId }, { $set: { pushToken } });
};

// --- Blocking (all numbers E.164-normalized before reaching here) ---

exports.getBlockedNumbers = async (userId) => {
    const user = await Model.findOne({ userId }).select('+blockedNumbers').lean();
    if (!user) return null;
    return user.blockedNumbers || [];
};

exports.isBlocked = async (ownerUserId, phoneNumber) => {
    if (!phoneNumber) return false;
    const match = await Model.exists({ userId: ownerUserId, 'blockedNumbers.phoneNumber': phoneNumber });
    return !!match;
};

exports.block = async (userId, { phoneNumber, name }) => {
    // Pull any existing entry first so re-blocking refreshes the name.
    await Model.updateOne({ userId }, { $pull: { blockedNumbers: { phoneNumber } } });
    return Model.updateOne(
        { userId },
        { $push: { blockedNumbers: { phoneNumber, name: name || 'Unknown' } } },
    );
};

exports.unblock = (userId, phoneNumber) => Model.updateOne(
    { userId },
    { $pull: { blockedNumbers: { phoneNumber } } },
);

// Full doc (secrets included) returned for archiving; caller cascades from there.
exports.remove = (userId) => Model.findOneAndDelete({ userId })
    .select('+blockedNumbers +pushToken')
    .lean();
