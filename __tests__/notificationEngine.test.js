const db = require('./helpers/db');
const { notifyUser } = require('../services/notificationService');
const NotificationModel = require('../models/notificationModel');
const DeliveryModel = require('../models/deliveryModel');

beforeAll(db.connect);
afterAll(db.disconnect);

describe('notification engine core (feature 02)', () => {
    test('dedupeKey collapses duplicate sends: one delivery, one inbox row', async () => {
        const args = {
            userId: 'user_dupe',
            eventKey: 'new_scan',
            dedupeKey: 'scan:int_dupe',
            title: 'Vehicle scanned',
            body: 'x',
            channels: ['inapp'],
        };
        const first = await notifyUser(args);
        const second = await notifyUser(args);
        expect(first.inapp).toBe('delivered');
        expect(second.inapp).toBe('duplicate');
        expect(await NotificationModel.countDocuments({ userId: 'user_dupe' })).toBe(1);
        expect(await DeliveryModel.countDocuments({ userId: 'user_dupe', channel: 'inapp' })).toBe(1);
    });

    test('push with no registered tokens: reported, nothing recorded, no throw', async () => {
        const out = await notifyUser({
            userId: 'user_ghost',
            eventKey: 'new_scan',
            dedupeKey: 'scan:none',
            title: 'x',
            channels: ['push'],
        });
        expect(out.push).toBe('no_tokens');
        expect(await DeliveryModel.countDocuments({ userId: 'user_ghost' })).toBe(0);
    });

    test('inbox rows carry the TTL expiry', async () => {
        await notifyUser({
            userId: 'user_ttl',
            eventKey: 'system',
            dedupeKey: 'ttl:1',
            title: 'x',
            channels: ['inapp'],
        });
        const doc = await NotificationModel.findOne({ userId: 'user_ttl' }).lean();
        expect(doc.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);
    });
});
