const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { generateSessionToken, refreshIfDue, verifyToken } = require('../utils/token');

const DAY = 24 * 60 * 60;
const user = { userId: 'user_test1', jwtSalt: 'salt-a' };

const decode = (token) => jwt.decode(token);

describe('session token + sliding refresh', () => {
    test('session token carries sid, sxp, salt and idle life', () => {
        const info = decode(generateSessionToken(user));
        expect(info.userId).toBe(user.userId);
        expect(info.jwtSalt).toBe(user.jwtSalt);
        expect(info.sid).toHaveLength(32);
        expect(info.exp - info.iat).toBe(config.security.tokenIdleDays * DAY);
        expect(info.sxp - info.iat).toBeGreaterThanOrEqual(config.security.absoluteSessionDays * DAY - 5);
    });

    test('fresh token is not refreshed', () => {
        const info = decode(generateSessionToken(user));
        expect(refreshIfDue({ info, user, now: info.iat + 60 })).toBeNull();
    });

    test('token older than a day refreshes, keeping sid and sxp', () => {
        const info = decode(generateSessionToken(user));
        const refreshed = refreshIfDue({ info, user, now: info.iat + DAY + 60 });
        expect(refreshed).not.toBeNull();
        const next = decode(refreshed);
        expect(next.sid).toBe(info.sid);
        expect(next.sxp).toBe(info.sxp);
        expect(next.exp - next.iat).toBe(config.security.tokenIdleDays * DAY);
    });

    test('refresh never outlives the absolute session expiry', () => {
        const info = decode(generateSessionToken(user));
        const nearEnd = info.sxp - 5 * DAY; // 5 days of session left
        const next = decode(refreshIfDue({ info, user, now: nearEnd }));
        expect(next.exp - next.iat).toBe(5 * DAY);
    });

    test('past absolute expiry no refresh is issued', () => {
        const info = decode(generateSessionToken(user));
        expect(refreshIfDue({ info, user, now: info.sxp + 1 })).toBeNull();
    });

    test('force refresh re-signs with the CURRENT salt (post-rotation handoff)', () => {
        const info = decode(generateSessionToken(user));
        const rotated = { ...user, jwtSalt: 'salt-b' };
        const next = decode(refreshIfDue({ info, user: rotated, force: true, now: info.iat + 60 }));
        expect(next.jwtSalt).toBe('salt-b');
    });

    test('verifyToken rejects tampered tokens', () => {
        const token = generateSessionToken(user);
        expect(() => verifyToken(`${token}x`)).toThrow();
    });
});
