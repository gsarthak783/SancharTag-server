const db = require('./helpers/db');
const UserModel = require('../models/userModel');
const VehicleModel = require('../models/vehicleModel');
const NotificationModel = require('../models/notificationModel');
const DeliveryModel = require('../models/deliveryModel');
const { runNoVehicleNudges, runTestTagNudges, runWinbackNudges } = require('../jobs/lifecycle');
const { generateUserId, generateVehicleId, generateTagId, generateJwtSalt, generateShortCode } = require('../utils/ids');

beforeAll(db.connect);
afterAll(db.disconnect);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.now();

// timestamps:true overwrites createdAt on create — force it post-insert.
const makeUser = async ({ ageMs, vehicleCount = 0, prefs, lastActiveAt, lastScanAt }) => {
    const userId = generateUserId();
    await UserModel.create({
        userId,
        phoneNumber: `+9198${Math.floor(Math.random() * 1e8)}`,
        jwtSalt: generateJwtSalt(),
        vehicleCount,
        ...(lastActiveAt && { lastActiveAt }),
        ...(lastScanAt && { lastScanAt }),
        ...(prefs && { notificationPreferences: prefs }),
    });
    await UserModel.collection.updateOne({ userId }, { $set: { createdAt: new Date(NOW - ageMs) } });
    return userId;
};

describe('lifecycle nudges (feature 02, phase B)', () => {
    test('no-vehicle: T+1h fires once, is idempotent, and 3d takes over the old cohort', async () => {
        const fresh = await makeUser({ ageMs: 2 * HOUR });        // 1h window
        const stale = await makeUser({ ageMs: 4 * DAY });         // 3d window only
        const covered = await makeUser({ ageMs: 2 * HOUR, vehicleCount: 1 }); // has a vehicle

        await runNoVehicleNudges(NOW);
        await runNoVehicleNudges(NOW); // re-scan must not duplicate

        const freshRows = await NotificationModel.find({ userId: fresh }).lean();
        expect(freshRows).toHaveLength(1);
        expect(freshRows[0].type).toBe('nudge_first_vehicle_1h');

        const staleRows = await NotificationModel.find({ userId: stale }).lean();
        expect(staleRows).toHaveLength(1);
        expect(staleRows[0].type).toBe('nudge_first_vehicle_3d');

        expect(await NotificationModel.countDocuments({ userId: covered })).toBe(0);
    });

    test('fire-time re-check: creating a vehicle before the scan stops the nudge', async () => {
        const userId = await makeUser({ ageMs: 2 * HOUR });
        await UserModel.updateOne({ userId }, { $set: { vehicleCount: 1 } }); // acted on day 0
        await runNoVehicleNudges(NOW);
        expect(await NotificationModel.countDocuments({ userId })).toBe(0);
    });

    test('opt-out: push recorded as suppressed_optout, inbox still lands', async () => {
        const userId = await makeUser({
            ageMs: 2 * HOUR,
            prefs: { systemUpdates: false },
        });
        await UserModel.updateOne({ userId }, {
            $set: { expoTokens: [{ token: 'ExponentPushToken[x]', deviceId: 'd', platform: 'android', lastSeenAt: new Date() }] },
        });
        await runNoVehicleNudges(NOW);

        expect(await NotificationModel.countDocuments({ userId })).toBe(1);
        const push = await DeliveryModel.findOne({ userId, channel: 'push' }).lean();
        expect(push.status).toBe('suppressed_optout');
    });

    test('test-tag: 14d-old vehicle + never scanned → nudged; scanned → not', async () => {
        const never = await makeUser({ ageMs: 20 * DAY, vehicleCount: 1 });
        const scanned = await makeUser({ ageMs: 20 * DAY, vehicleCount: 1, lastScanAt: new Date(NOW - DAY) });
        for (const userId of [never, scanned]) {
            const vehicleId = generateVehicleId();
            await VehicleModel.create({
                vehicleId, userId, vehicleName: 'V', vehicleNumber: `MH${Math.floor(Math.random() * 1e6)}`,
                tagId: generateTagId(), shortCode: generateShortCode(),
            });
            await VehicleModel.collection.updateOne({ vehicleId }, { $set: { createdAt: new Date(NOW - 15 * DAY) } });
        }
        await runTestTagNudges(NOW);

        const rows = await NotificationModel.find({ userId: never }).lean();
        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('nudge_test_tag');
        expect(await NotificationModel.countDocuments({ userId: scanned })).toBe(0);
    });

    test('winback: dormant 30d → nudged once', async () => {
        const dormant = await makeUser({ ageMs: 60 * DAY, vehicleCount: 1, lastActiveAt: new Date(NOW - 35 * DAY) });
        const active = await makeUser({ ageMs: 60 * DAY, vehicleCount: 1, lastActiveAt: new Date(NOW - 2 * DAY) });
        await runWinbackNudges(NOW);
        await runWinbackNudges(NOW);

        expect(await NotificationModel.countDocuments({ userId: dormant, type: 'winback_30d' })).toBe(1);
        expect(await NotificationModel.countDocuments({ userId: active })).toBe(0);
    });
});
