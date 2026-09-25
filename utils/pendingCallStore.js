// Buffered incoming calls for owners whose socket is mid-reconnect (flaky
// mobile networks). In-memory with TTL — same interface a Redis-backed
// implementation will expose when we go multi-instance.
const TTL_MS = 30 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

const store = new Map(); // userId -> { payload, expiresAt }

const set = (userId, payload) => {
    store.set(userId, { payload, expiresAt: Date.now() + TTL_MS });
};

const get = (userId) => {
    const entry = store.get(userId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(userId);
        return null;
    }
    return entry.payload;
};

const remove = (userId) => store.delete(userId);

// Abandoned entries (call never answered, owner never reconnected) get swept —
// this Map must never grow unbounded.
const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of store) {
        if (now > entry.expiresAt) store.delete(userId);
    }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

module.exports = { set, get, remove, TTL_MS };
