const request = require('supertest');
const db = require('./helpers/db');
const app = require('../app');
const UserModel = require('../models/userModel');
const CampaignModel = require('../models/campaignModel');
const NotificationModel = require('../models/notificationModel');
const { runDueCampaigns } = require('../jobs/campaignRunner');
const { generateUserId, generateJwtSalt } = require('../utils/ids');

const KEY = 'test-admin-internal-key';
const admin = (method, path) => request(app)[method](`/api/v1/admin${path}`)
    .set('x-admin-key', KEY)
    .set('x-acting-admin', 'adm_test');

beforeAll(db.connect);
afterAll(db.disconnect);

const makeUser = (vehicleCount) => UserModel.create({
    userId: generateUserId(),
    phoneNumber: `+9197${Math.floor(Math.random() * 1e8)}`,
    jwtSalt: generateJwtSalt(),
    vehicleCount,
    name: 'Seg User',
});

describe('campaigns (feature 02, phase C)', () => {
    test('template CRUD + audience preview over the admin surface', async () => {
        const created = await admin('post', '/templates').send({
            key: 'welcome_push',
            name: 'Welcome push',
            channels: {
                push: { title: 'Hey {{name}}', body: 'Print your tag today.' },
                inapp: { title: 'Hey {{name}}', body: 'Print your tag today.', deepLink: '/add-vehicle' },
            },
            variables: ['name'],
        });
        expect(created.status).toBe(201);

        await makeUser(0);
        await makeUser(0);
        await makeUser(2);

        const preview = await admin('post', '/audience-preview')
            .send({ audience: { kind: 'preset', preset: 'no_vehicle' } });
        expect(preview.status).toBe(200);
        expect(preview.body.data.count).toBeGreaterThanOrEqual(2);

        const evil = await admin('post', '/audience-preview')
            .send({ audience: { kind: 'query', query: { $where: 'sleep(1000)' } } });
        expect(evil.status).toBe(422);
    });

    test('campaign lifecycle: schedule now → runner sends to the segment once → done', async () => {
        const create = await admin('post', '/campaigns').send({
            name: 'Welcome blast',
            templateKey: 'welcome_push',
            channels: ['inapp'],
            audience: { kind: 'preset', preset: 'no_vehicle' },
            schedule: { kind: 'now' },
        });
        expect(create.status).toBe(201);
        const { campaignId } = create.body.data;

        await runDueCampaigns(new Date());
        await runDueCampaigns(new Date()); // nothing left to claim

        const after = await CampaignModel.findOne({ campaignId }).lean();
        expect(after.state).toBe('done');
        expect(after.stats.targeted).toBeGreaterThanOrEqual(2);
        expect(after.stats.delivered).toBe(after.stats.targeted);

        // Variables rendered per user, campaign stamped on the inbox row.
        const row = await NotificationModel.findOne({ campaignId }).lean();
        expect(row.title).toBe('Hey Seg User');

        // No-vehicle users got exactly one inbox row each from this campaign.
        const counts = await NotificationModel.aggregate([
            { $match: { campaignId } },
            { $group: { _id: '$userId', n: { $sum: 1 } } },
        ]);
        expect(counts.every((c) => c.n === 1)).toBe(true);
    });

    test('pause blocks the runner; resume re-queues', async () => {
        const create = await admin('post', '/campaigns').send({
            name: 'Paused blast',
            templateKey: 'welcome_push',
            channels: ['inapp'],
            audience: { kind: 'preset', preset: 'no_vehicle' },
            schedule: { kind: 'now' },
        });
        const { campaignId } = create.body.data;

        expect((await admin('post', `/campaigns/${campaignId}/pause`)).status).toBe(200);
        await runDueCampaigns(new Date());
        expect((await CampaignModel.findOne({ campaignId }).lean()).state).toBe('paused');

        expect((await admin('post', `/campaigns/${campaignId}/resume`)).status).toBe(200);
        await runDueCampaigns(new Date());
        expect((await CampaignModel.findOne({ campaignId }).lean()).state).toBe('done');
    });

    test('recurring campaigns reschedule with a future nextRunAt', async () => {
        const create = await admin('post', '/campaigns').send({
            name: 'Weekly digest',
            templateKey: 'welcome_push',
            channels: ['inapp'],
            audience: { kind: 'preset', preset: 'all_active' },
            schedule: { kind: 'recurring', cron: '0 10 * * 1' },
        });
        expect(create.status).toBe(201);
        const { campaignId, nextRunAt } = create.body.data;
        expect(new Date(nextRunAt).getTime()).toBeGreaterThan(Date.now());

        // Force it due, run, and it must re-queue instead of finishing.
        await CampaignModel.updateOne({ campaignId }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });
        await runDueCampaigns(new Date());
        const after = await CampaignModel.findOne({ campaignId }).lean();
        expect(after.state).toBe('scheduled');
        expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    });
});
