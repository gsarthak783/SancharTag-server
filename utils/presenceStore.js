// Chat presence (feature 04 §presence): Redis-free in-memory tracking, same
// single-instance posture as pendingCallStore — swap-ready for an adapter.
// A role is "online in the chat" while it has ≥1 socket in that interaction
// room (owners join on chat open, scanners on session connect), so presence
// means "this chat is on their screen", not "the app is installed somewhere".

const rooms = new Map(); // interactionId -> { owner: Set<socketId>, scanner: Set<socketId> }
const lastSeen = new Map(); // interactionId -> { owner?: Date, scanner?: Date }
const LAST_SEEN_CAP = 5000; // bounded: prune oldest interaction when exceeded

const roomFor = (interactionId) => {
    let r = rooms.get(interactionId);
    if (!r) {
        r = { owner: new Set(), scanner: new Set() };
        rooms.set(interactionId, r);
    }
    return r;
};

/** Socket entered the chat. Returns true when the role flipped offline→online. */
exports.enter = (interactionId, role, socketId) => {
    const set = roomFor(interactionId)[role];
    if (!set) return false;
    const wasEmpty = set.size === 0;
    set.add(socketId);
    return wasEmpty;
};

/** Socket left the chat. Returns true when the role flipped online→offline. */
exports.leave = (interactionId, role, socketId) => {
    const r = rooms.get(interactionId);
    if (!r?.[role]?.delete(socketId)) return false;
    if (r[role].size > 0) return false;

    const seen = lastSeen.get(interactionId) || {};
    seen[role] = new Date();
    lastSeen.delete(interactionId); // re-insert = LRU order on the Map
    lastSeen.set(interactionId, seen);
    if (lastSeen.size > LAST_SEEN_CAP) {
        lastSeen.delete(lastSeen.keys().next().value);
    }
    if (r.owner.size === 0 && r.scanner.size === 0) rooms.delete(interactionId);
    return true;
};

/** Current state of both roles — what a newly joined socket gets replayed. */
exports.snapshot = (interactionId) => {
    const r = rooms.get(interactionId);
    const seen = lastSeen.get(interactionId) || {};
    return {
        owner: { online: !!r && r.owner.size > 0, lastSeenAt: seen.owner || null },
        scanner: { online: !!r && r.scanner.size > 0, lastSeenAt: seen.scanner || null },
    };
};

// Test hook.
exports._reset = () => {
    rooms.clear();
    lastSeen.clear();
};
