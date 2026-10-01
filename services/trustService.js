const { TrustEvent, PlatformRestriction } = require('../models/trustModels');
const logger = require('../utils/logger');

const DAY = 24 * 3600 * 1000;
const LEVEL_RANK = { watch: 1, restricted: 2, banned: 3 };

/**
 * Feature 09 rules (phase B). Escalation only — the engine never downgrades
 * and never bans (banned is a human decision):
 *  - 3 distinct owners blocked this phone in 30d        → watch
 *  - 2 upheld reports (moderator marked 'actioned')     → restricted
 *  - 2+ interaction-flood events in 7d                  → watch
 */
const evaluate = async (phoneNumber) => {
    const since30d = new Date(Date.now() - 30 * DAY);
    const [blockOwners, upheld, floods, current] = await Promise.all([
        TrustEvent.distinct('ownerUserId', {
            phoneNumber, kind: 'blocked_by_owner', createdAt: { $gte: since30d },
        }),
        TrustEvent.countDocuments({ phoneNumber, kind: 'report_upheld' }),
        TrustEvent.countDocuments({
            phoneNumber, kind: 'interaction_flood', createdAt: { $gte: new Date(Date.now() - 7 * DAY) },
        }),
        PlatformRestriction.findOne({ phoneNumber }).lean(),
    ]);

    let target = null;
    if (blockOwners.filter(Boolean).length >= 3 || floods >= 2) target = 'watch';
    if (upheld >= 2) target = 'restricted';
    if (!target) return current;
    if (current && LEVEL_RANK[current.level] >= LEVEL_RANK[target]) return current;

    const reason = target === 'restricted'
        ? `${upheld} reports upheld by moderators`
        : blockOwners.length >= 3
            ? `Blocked by ${blockOwners.length} different owners in 30 days`
            : `${floods} interaction-flood signals in 7 days`;

    const updated = await PlatformRestriction.findOneAndUpdate(
        { phoneNumber },
        { $set: { level: target, reason, setBy: 'system' }, $unset: { expiresAt: 1 } },
        { upsert: true, new: true, lean: true },
    );
    logger.warn('trust: restriction escalated', { phoneNumber, level: target, reason });
    return updated;
};

// Passive collection first (phase A): every event lands, rules run inline.
exports.recordEvent = async ({ phoneNumber, kind, ownerUserId = null, interactionId = null }) => {
    if (!phoneNumber) return null;
    try {
        await TrustEvent.create({ phoneNumber, kind, ownerUserId, interactionId });
        return await evaluate(phoneNumber);
    } catch (err) {
        logger.error('trust: event write failed', { kind, error: err.message });
        return null;
    }
};

// THE enforcement lookup — one indexed read at scanner-OTP and
// interaction-create. Expired restrictions don't bite.
exports.getActiveRestriction = async (phoneNumber) => {
    if (!phoneNumber) return null;
    const r = await PlatformRestriction.findOne({ phoneNumber }).lean();
    if (!r) return null;
    if (r.expiresAt && r.expiresAt < new Date()) return null;
    return r;
};

exports.isBlockedFromPlatform = async (phoneNumber) => {
    const r = await exports.getActiveRestriction(phoneNumber);
    return !!r && (r.level === 'restricted' || r.level === 'banned');
};

// --- Console (manual moderation; audited console-side) ---

exports.setRestriction = (phoneNumber, { level, reason, setBy, expiresAt }) =>
    PlatformRestriction.findOneAndUpdate(
        { phoneNumber },
        { $set: { level, reason, setBy, ...(expiresAt ? { expiresAt } : {}) }, ...(expiresAt ? {} : { $unset: { expiresAt: 1 } }) },
        { upsert: true, new: true, lean: true },
    );

exports.clearRestriction = (phoneNumber) =>
    PlatformRestriction.findOneAndDelete({ phoneNumber }).lean();

exports.watchlist = async ({ page = 1, limit = 20 } = {}) => {
    const skip = (Math.max(+page, 1) - 1) * +limit;
    const [items, totalCount] = await Promise.all([
        PlatformRestriction.find({}).sort({ updatedAt: -1 }).skip(skip).limit(+limit).lean(),
        PlatformRestriction.countDocuments({}),
    ]);
    return { items, totalCount, page: +page, totalPages: Math.ceil(totalCount / +limit) || 1 };
};

exports.timeline = (phoneNumber, limit = 100) =>
    TrustEvent.find({ phoneNumber }).sort({ createdAt: -1 }).limit(limit).lean();
