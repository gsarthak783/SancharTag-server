const request = require('supertest');
const db = require('./helpers/db');
const app = require('../app');
const config = require('../config/config');
const InteractionModel = require('../models/interactionModel');

const OWNER_PHONE = '+919876500001';
const OWNER2_PHONE = '+919876500002';
const SCANNER_PHONE = '+919876500003';

// Shared state built up across this sequential suite (jest --runInBand).
const state = {};

beforeAll(db.connect);
afterAll(db.disconnect);

const loginWithMasterOtp = async (phoneNumber) => {
    const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phoneNumber, otp: config.otp.masterOtp });
    expect(res.status).toBe(200);
    return res.body.data;
};

describe('SancharTag API — end to end', () => {
    test('health endpoint is open', async () => {
        const res = await request(app).get('/api/v1/health');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(1);
    });

    test('unknown route returns structured 404', async () => {
        const res = await request(app).get('/api/v1/nope');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    });

    test('send-otp → verify-otp issues a session (dev mode exposes OTP)', async () => {
        const sendRes = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: OWNER_PHONE });
        expect(sendRes.status).toBe(200);
        expect(sendRes.body.data.otp).toMatch(/^\d{6}$/); // SMS_ENABLED=false + non-prod only

        const verifyRes = await request(app)
            .post('/api/v1/auth/verify-otp')
            .send({ phoneNumber: OWNER_PHONE, otp: sendRes.body.data.otp });
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.data.isNewUser).toBe(true);
        expect(verifyRes.body.data.token).toBeDefined();
        expect(verifyRes.body.data.user.jwtSalt).toBeUndefined();

        state.ownerToken = verifyRes.body.data.token;
        state.ownerUserId = verifyRes.body.data.user.userId;
        expect(state.ownerUserId).toMatch(/^user_/);
    });

    test('owner routes reject missing/invalid tokens', async () => {
        expect((await request(app).get('/api/v1/users/me')).status).toBe(401);
        expect((await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    });

    test('PATCH /users/me: allowlist blocks mass assignment', async () => {
        const res = await request(app)
            .patch('/api/v1/users/me')
            .set('Authorization', `Bearer ${state.ownerToken}`)
            .send({
                name: 'Owner One',
                status: 'suspended',            // NOT writable
                userId: 'user_hijacked',        // NOT writable
                phoneNumber: '+911111111111',   // NOT writable
            });
        expect(res.status).toBe(200);
        expect(res.body.data.name).toBe('Owner One');
        expect(res.body.data.status).toBe('active');
        expect(res.body.data.userId).toBe(state.ownerUserId);
        expect(res.body.data.phoneNumber).toBe(OWNER_PHONE);
    });

    test('vehicle create: server generates IDs; scanner-safe tag format', async () => {
        const res = await request(app)
            .post('/api/v1/vehicles')
            .set('Authorization', `Bearer ${state.ownerToken}`)
            .send({ vehicleName: 'My Swift', vehicleNumber: 'MH12AB1234', vehicleType: 'Car' });
        expect(res.status).toBe(201);
        expect(res.body.data.vehicleId).toMatch(/^veh_/);
        expect(res.body.data.tagId).toMatch(/^tag_/);
        state.vehicle = res.body.data;
    });

    test('another owner cannot touch this vehicle', async () => {
        const owner2 = await loginWithMasterOtp(OWNER2_PHONE);
        const res = await request(app)
            .patch(`/api/v1/vehicles/${state.vehicle.vehicleId}`)
            .set('Authorization', `Bearer ${owner2.token}`)
            .send({ vehicleName: 'stolen' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('NOT_OWNER');
    });

    test('scan view leaks NOTHING about the owner', async () => {
        const res = await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`);
        expect(res.status).toBe(200);
        expect(res.body.data.vehicle.vehicleNumber).toBe('MH12AB1234');
        expect(res.body.data.scanToken).toBeDefined();

        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain(OWNER_PHONE);
        expect(raw).not.toContain(state.ownerUserId);
        expect(raw).not.toContain(state.vehicle.vehicleId);
        expect(raw).not.toContain('_id');
        state.scanToken = res.body.data.scanToken;
    });

    test('unknown tag → 404', async () => {
        const res = await request(app).get('/api/v1/scan/tag_doesnotexist');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('TAG_NOT_FOUND');
    });

    test('scan token creates ONE interaction (single-use jti)', async () => {
        const first = await request(app)
            .post(`/api/v1/scan/${state.vehicle.tagId}/interactions`)
            .send({ scanToken: state.scanToken, phoneNumber: SCANNER_PHONE, type: 'Wrong Parking' });
        expect(first.status).toBe(201);
        expect(first.body.data.interactionToken).toBeDefined();
        expect(first.body.data.interaction.interactionId).toMatch(/^int_/);
        state.interactionId = first.body.data.interaction.interactionId;
        state.interactionToken = first.body.data.interactionToken;

        const replay = await request(app)
            .post(`/api/v1/scan/${state.vehicle.tagId}/interactions`)
            .send({ scanToken: state.scanToken, phoneNumber: SCANNER_PHONE });
        expect(replay.status).toBe(401);
        expect(replay.body.code).toBe('SCAN_TOKEN_USED');
    });

    test('scanner token is scoped to its own interaction', async () => {
        const own = await request(app)
            .get(`/api/v1/interactions/${state.interactionId}`)
            .set('Authorization', `Bearer ${state.interactionToken}`);
        expect(own.status).toBe(200);
        // Scanner view: no owner identifiers, no capture context.
        const raw = JSON.stringify(own.body);
        expect(raw).not.toContain(state.ownerUserId);
        expect(own.body.data.scanner).toBeUndefined();

        const other = await request(app)
            .get('/api/v1/interactions/int_someoneelses')
            .set('Authorization', `Bearer ${state.interactionToken}`);
        expect(other.status).toBe(401);
    });

    test('scanner sends a message; owner sees it in the paginated list', async () => {
        const msg = await request(app)
            .post(`/api/v1/interactions/${state.interactionId}/messages`)
            .set('Authorization', `Bearer ${state.interactionToken}`)
            .send({ text: 'Your car is blocking my gate' });
        expect(msg.status).toBe(201);
        expect(msg.body.data.senderRole).toBe('scanner'); // derived from token, not payload

        const list = await request(app)
            .get('/api/v1/interactions')
            .set('Authorization', `Bearer ${state.ownerToken}`);
        expect(list.status).toBe(200);
        expect(list.body.data.totalCount).toBe(1);
        const item = list.body.data.items[0];
        expect(item.lastMessage).toBe('Your car is blocking my gate');
        expect(item.unreadCount).toBe(1);
        expect(item.messages).toBeUndefined(); // list projection: no message arrays
    });

    test('resolved sessions accept no more messages (no reactivation)', async () => {
        const resolve = await request(app)
            .patch(`/api/v1/interactions/${state.interactionId}/resolve`)
            .set('Authorization', `Bearer ${state.ownerToken}`);
        expect(resolve.status).toBe(200);
        expect(resolve.body.data.status).toBe('resolved');

        const rejected = await request(app)
            .post(`/api/v1/interactions/${state.interactionId}/messages`)
            .set('Authorization', `Bearer ${state.interactionToken}`)
            .send({ text: 'still there?' });
        expect(rejected.status).toBe(409);
        expect(rejected.body.code).toBe('SESSION_ENDED');
    });

    test('blocking closes open sessions AND prevents new interactions', async () => {
        // Fresh ACTIVE interaction from the (not yet blocked) scanner:
        const preScan = await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`);
        const fresh = await request(app)
            .post(`/api/v1/scan/${state.vehicle.tagId}/interactions`)
            .send({ scanToken: preScan.body.data.scanToken, phoneNumber: SCANNER_PHONE });
        expect(fresh.status).toBe(201);
        const freshId = fresh.body.data.interaction.interactionId;

        const block = await request(app)
            .post('/api/v1/users/me/blocked')
            .set('Authorization', `Bearer ${state.ownerToken}`)
            .send({ phoneNumber: SCANNER_PHONE, name: 'Rude Person' });
        expect(block.status).toBe(200);

        // The open session was force-closed with system-set 'blocked' status.
        const closed = await InteractionModel.findOne({ interactionId: freshId }).lean();
        expect(closed.status).toBe('blocked');

        // And no new interaction can be created by that phone.
        const scan = await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`);
        const before = await InteractionModel.countDocuments({});
        const attempt = await request(app)
            .post(`/api/v1/scan/${state.vehicle.tagId}/interactions`)
            .send({ scanToken: scan.body.data.scanToken, phoneNumber: SCANNER_PHONE });
        expect(attempt.status).toBe(403);
        expect(attempt.body.code).toBe('BLOCKED_BY_OWNER');
        expect(await InteractionModel.countDocuments({})).toBe(before); // no row created
    });

    test('logout revokes every session token (salt rotation)', async () => {
        const logout = await request(app)
            .post('/api/v1/auth/logout')
            .set('Authorization', `Bearer ${state.ownerToken}`);
        expect(logout.status).toBe(200);

        const after = await request(app)
            .get('/api/v1/users/me')
            .set('Authorization', `Bearer ${state.ownerToken}`);
        expect(after.status).toBe(401);
        expect(after.body.code).toBe('SESSION_EXPIRED');
    });
});
