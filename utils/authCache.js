/**
 * Tiny per-instance TTL cache for the auth-middleware user row. Every authed
 * request pays one DB roundtrip for it (~200ms while compute sits far from
 * Atlas) — a 30s cache removes that from the hot path.
 *
 * Correctness: salt rotation (logout / force-logout) and suspension PURGE the
 * entry locally, so same-instance revocation is instant; the worst case on a
 * multi-instance deploy is a token surviving ≤ TTL after revocation, which is
 * an accepted trade at 30s. Cleared entirely on process restart/deploy.
 */
const TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS || 30_000);
const MAX_ENTRIES = 5000;

const cache = new Map(); // userId → { user, expiresAt }

const get = (userId) => {
    const hit = cache.get(userId);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        cache.delete(userId);
        return null;
    }
    return hit.user;
};

const set = (userId, user) => {
    if (TTL_MS <= 0) return;
    if (cache.size >= MAX_ENTRIES) {
        // Drop the oldest entry — auth rows are tiny, this is a backstop.
        cache.delete(cache.keys().next().value);
    }
    cache.set(userId, { user, expiresAt: Date.now() + TTL_MS });
};

const purge = (userId) => cache.delete(userId);
const clear = () => cache.clear();

module.exports = { get, set, purge, clear };
