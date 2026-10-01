const request = require('supertest');
const db = require('./helpers/db');
const app = require('../app');
const config = require('../config/config');
const { TrustEvent, PlatformRestriction } = require('../models/trustModels');
const trustService = require('../services/trustService');
const UserModel = require('../models/userModel');
const { generateUserId, generateJwtSalt } = require('../utils/ids');

const KEY = 'test-admin-internal-key';
const admin = (method, path) => request(app)[method](`/api/v1/admin${path}`)
    .set('x-admin-key', KEY).set('x-acting-admin', 'adm_trust');

beforeAll(db.connect);
afterAll(db.disconnect);

const PHONE = '+919876511111';

describe('trust & safety (feature 09)', () => {
    test('3 distinct-owner blocks in 30d → watch; same owner thrice does NOT', async () => {
        await trustService.recordEvent({ phoneNumber: '+919876522222', kind: 'blocked_by_owner', ownerUserId: 'own_a' });
        await trustService.recordEvent({ phoneNumber: '+919876522222', kind: 'blocked_by_owner', ownerUserId: 'own_a' });
        await trustService.recordEvent({ phoneNumber: '+919876522222', kind: 'blocked_by_owner', ownerUserId: 'own_a' });
        expect(await PlatformRestriction.findOne({ phoneNumber: '+919876522222' })).toBeNull();

        await trustService.recordEvent({ phoneNumber: PHONE, kind: 'blocked_by_owner', ownerUserId: 'own_1' });
        await trustService.recordEvent({ phoneNumber: PHONE, kind: 'blocked_by_owner', ownerUserId: 'own_2' });
        const r = await trustService.recordEvent({ phoneNumber: PHONE, kind: 'blocked_by_owner', ownerUserId: 'own_3' });
        expect(r.level).toBe('watch');
    });

    test('watch does not restrict; 2 upheld reports do', async () => {
        expect(await trustService.isBlockedFromPlatform(PHONE)).toBe(false);
        await trustService.recordEvent({ phoneNumber: PHONE, kind: 'report_upheld', ownerUserId: 'own_1' });
        const r = await trustService.recordEvent({ phoneNumber: PHONE, kind: 'report_upheld', ownerUserId: 'own_2' });
        expect(r.level).toBe('restricted');
        expect(await trustService.isBlockedFromPlatform(PHONE)).toBe(true);
    });

    test('restricted phone is refused at scanner OTP verification', async () => {
        const res = await request(app)
            .post('/api/v1/auth/verify-scanner-otp')
            .send({ phoneNumber: PHONE, otp: config.otp.masterOtp });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SCANNER_RESTRICTED');
    });

    test('rules engine never downgrades a manual ban', async () => {
        await trustService.setRestriction(PHONE, { level: 'banned', reason: 'manual test ban', setBy: 'adm_x' });
        await trustService.recordEvent({ phoneNumber: PHONE, kind: 'blocked_by_owner', ownerUserId: 'own_9' });
        const r = await trustService.getActiveRestriction(PHONE);
        expect(r.level).toBe('banned');
    });

    test('admin surface: watchlist, timeline, clear', async () => {
        const list = await admin('get', '/trust');
        expect(list.status).toBe(200);
        expect(list.body.data.items.some((i) => i.phoneNumber === PHONE)).toBe(true);

        const tl = await admin('get', `/trust/${encodeURIComponent(PHONE)}`);
        expect(tl.status).toBe(200);
        expect(tl.body.data.events.length).toBeGreaterThanOrEqual(5);
        expect(tl.body.data.restriction.level).toBe('banned');

        expect((await admin('post', `/trust/${encodeURIComponent(PHONE)}/clear`)).status).toBe(200);
        expect(await trustService.isBlockedFromPlatform(PHONE)).toBe(false);
    });

    test('block v2: entry carries blockedAt + sourceInteractionId and feeds an event', async () => {
        const login = await request(app).post('/api/v1/auth/verify-otp')
            .send({ phoneNumber: '+919876533333', otp: config.otp.masterOtp });
        const token = login.body.data.token;
        const res = await request(app).post('/api/v1/users/me/blocked')
            .set('Authorization', `Bearer ${token}`)
            .send({ phoneNumber: '+919876544444', name: 'Pest', interactionId: 'int_ctx1' });
        expect(res.status).toBe(200);
        const entry = res.body.data.find((b) => b.phoneNumber === '+919876544444');
        expect(entry.sourceInteractionId).toBe('int_ctx1');
        expect(new Date(entry.blockedAt).getTime()).toBeGreaterThan(0);
        await new Promise((r) => setTimeout(r, 200));
        expect(await TrustEvent.countDocuments({ phoneNumber: '+919876544444', kind: 'blocked_by_owner' })).toBe(1);
    });
});
