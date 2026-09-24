const request = require('supertest');
const db = require('./helpers/db');
const app = require('../app');
const config = require('../config/config');

const KEY = 'test-admin-internal-key';
const admin = (method, path) => request(app)[method](`/api/v1/admin${path}`)
    .set('x-admin-key', KEY)
    .set('x-acting-admin', 'adm_test');

const state = {};

beforeAll(db.connect);
afterAll(db.disconnect);

describe('internal admin API (console surface)', () => {
    test('rejects missing and wrong keys', async () => {
        expect((await request(app).get('/api/v1/admin/stats')).status).toBe(401);
        expect((await request(app).get('/api/v1/admin/stats').set('x-admin-key', 'nope')).status).toBe(401);
    });

    test('setup: owner + vehicle + interaction + report exist', async () => {
        const login = await request(app).post('/api/v1/auth/verify-otp')
            .send({ phoneNumber: '9876522001', otp: config.otp.masterOtp });
        state.ownerToken = login.body.data.token;
        state.userId = login.body.data.user.userId;

        const veh = await request(app).post('/api/v1/vehicles')
            .set('Authorization', `Bearer ${state.ownerToken}`)
            .send({ vehicleName: 'Admin Test Car', vehicleNumber: 'KA05AD0001' });
        state.vehicle = veh.body.data;

        const scan = await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`);
        const verify = await request(app).post('/api/v1/auth/verify-scanner-otp')
            .send({ phoneNumber: '9876522002', otp: config.otp.masterOtp });
        const created = await request(app).post(`/api/v1/scan/${state.vehicle.tagId}/interactions`)
            .send({ scanToken: scan.body.data.scanToken, scannerToken: verify.body.data.scannerToken, type: 'Wrong Parking' });
        state.interactionId = created.body.data.interaction.interactionId;

        const report = await request(app).post('/api/v1/reports')
            .set('Authorization', `Bearer ${created.body.data.interactionToken}`)
            .send({ interactionId: state.interactionId, category: 'Spam' });
        state.reportId = report.body.data.reportId;
        expect(report.status).toBe(201);
    });

    test('stats overview counts the world', async () => {
        const res = await admin('get', '/stats');
        expect(res.status).toBe(200);
        expect(res.body.data.users).toBeGreaterThanOrEqual(1);
        expect(res.body.data.vehicles).toBe(1);
        expect(res.body.data.openReports).toBe(1);
    });

    test('user search + detail (no secrets in payload)', async () => {
        const list = await admin('get', '/users?search=9876522001');
        expect(list.body.data.items).toHaveLength(1);

        const detail = await admin('get', `/users/${state.userId}`);
        expect(detail.body.data.vehicles).toHaveLength(1);
        expect(detail.body.data.interactionCounts.total).toBe(1);
        const raw = JSON.stringify(detail.body);
        expect(raw).not.toContain('jwtSalt');
        expect(raw).not.toContain('pushToken');
    });

    test('suspend kills sessions and blocks login; unsuspend restores', async () => {
        await admin('post', `/users/${state.userId}/suspend`);

        // Existing session refused — suspension answers before the (also
        // rotated) salt check, so the client gets the real reason.
        const me = await request(app).get('/api/v1/users/me')
            .set('Authorization', `Bearer ${state.ownerToken}`);
        expect(me.status).toBe(403);
        expect(me.body.code).toBe('ACCOUNT_SUSPENDED');
        // … and fresh login refused while suspended.
        const relog = await request(app).post('/api/v1/auth/verify-otp')
            .send({ phoneNumber: '9876522001', otp: config.otp.masterOtp });
        expect(relog.body.code).toBe('ACCOUNT_SUSPENDED');

        await admin('post', `/users/${state.userId}/unsuspend`);
        const relog2 = await request(app).post('/api/v1/auth/verify-otp')
            .send({ phoneNumber: '9876522001', otp: config.otp.masterOtp });
        expect(relog2.status).toBe(200);
        state.ownerToken = relog2.body.data.token;
    });

    test('tag deactivate/reactivate/regenerate control the scan surface', async () => {
        await admin('post', `/vehicles/${state.vehicle.vehicleId}/deactivate`);
        expect((await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`)).body.code).toBe('VEHICLE_INACTIVE');

        await admin('post', `/vehicles/${state.vehicle.vehicleId}/reactivate`);
        expect((await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`)).status).toBe(200);

        const regen = await admin('post', `/vehicles/${state.vehicle.vehicleId}/regenerate-tag`);
        const newTagId = regen.body.data.tagId;
        expect(newTagId).not.toBe(state.vehicle.tagId);
        expect((await request(app).get(`/api/v1/scan/${state.vehicle.tagId}`)).body.code).toBe('TAG_NOT_FOUND');
        expect((await request(app).get(`/api/v1/scan/${newTagId}`)).status).toBe(200);
    });

    test('report queue → detail (snapshot only in detail) → status workflow', async () => {
        const queue = await admin('get', '/reports?status=open');
        expect(queue.body.data.items).toHaveLength(1);
        expect(queue.body.data.items[0].interactionSnapshot).toBeUndefined();

        const detail = await admin('get', `/reports/${state.reportId}`);
        expect(detail.body.data.interactionSnapshot).toBeDefined();

        const done = await admin('patch', `/reports/${state.reportId}/status`).send({ status: 'reviewed' });
        expect(done.body.data.status).toBe('reviewed');
        expect((await admin('patch', `/reports/${state.reportId}/status`).send({ status: 'bogus' })).status).toBe(422);
    });

    test('interaction lookup is metadata-only (privacy rule)', async () => {
        const res = await admin('get', `/interactions/${state.interactionId}`);
        expect(res.status).toBe(200);
        expect(res.body.data.messages).toBeUndefined();
        expect(typeof res.body.data.messageCount).toBe('number');
    });

    test('admin delete cascades like self-delete', async () => {
        const res = await admin('delete', `/users/${state.userId}`);
        expect(res.status).toBe(200);
        expect(res.body.data.vehicles).toBe(1);
        expect((await admin('get', `/users/${state.userId}`)).status).toBe(404);
    });
});
