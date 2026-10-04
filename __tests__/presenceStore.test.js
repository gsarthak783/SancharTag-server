const presence = require('../utils/presenceStore');

describe('presenceStore (feature 04 §presence)', () => {
    beforeEach(() => presence._reset());

    test('first socket flips online, duplicates do not re-announce', () => {
        expect(presence.enter('int_1', 'owner', 's1')).toBe(true);
        expect(presence.enter('int_1', 'owner', 's2')).toBe(false); // second device
        expect(presence.snapshot('int_1').owner.online).toBe(true);
    });

    test('offline only when the LAST socket leaves, and lastSeen is stamped', () => {
        presence.enter('int_1', 'scanner', 's1');
        presence.enter('int_1', 'scanner', 's2');
        expect(presence.leave('int_1', 'scanner', 's1')).toBe(false);
        expect(presence.snapshot('int_1').scanner.online).toBe(true);

        expect(presence.leave('int_1', 'scanner', 's2')).toBe(true);
        const snap = presence.snapshot('int_1').scanner;
        expect(snap.online).toBe(false);
        expect(snap.lastSeenAt).toBeInstanceOf(Date);
    });

    test('roles are independent within one interaction', () => {
        presence.enter('int_1', 'owner', 'o1');
        presence.enter('int_1', 'scanner', 'c1');
        presence.leave('int_1', 'owner', 'o1');
        const snap = presence.snapshot('int_1');
        expect(snap.owner.online).toBe(false);
        expect(snap.scanner.online).toBe(true);
    });

    test('unknown interaction reads as offline with no lastSeen', () => {
        const snap = presence.snapshot('int_nope');
        expect(snap.owner).toEqual({ online: false, lastSeenAt: null });
        expect(snap.scanner).toEqual({ online: false, lastSeenAt: null });
    });

    test('leaving a room never entered is a no-op', () => {
        expect(presence.leave('int_1', 'owner', 'ghost')).toBe(false);
        expect(presence.snapshot('int_1').owner.lastSeenAt).toBeNull();
    });

    test('lastSeen map stays bounded (LRU prune past the cap)', () => {
        for (let i = 0; i < 5005; i += 1) {
            presence.enter(`int_${i}`, 'owner', 's');
            presence.leave(`int_${i}`, 'owner', 's');
        }
        // The earliest entries were pruned; the newest survive.
        expect(presence.snapshot('int_0').owner.lastSeenAt).toBeNull();
        expect(presence.snapshot('int_5004').owner.lastSeenAt).toBeInstanceOf(Date);
    });
});
