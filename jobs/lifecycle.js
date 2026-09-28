const UserModel = require('../models/userModel');
const VehicleModel = require('../models/vehicleModel');
const { notifyUser } = require('../services/notificationService');
const logger = require('../utils/logger');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const BATCH = 500;

/**
 * Lifecycle nudges (feature 02, phase B) as periodic SEGMENT SCANS: the
 * query itself is the fire-time condition re-check the spec demands (a user
 * who created a vehicle on day 2 simply stops matching), and the once-ever
 * dedupeKey makes every re-scan idempotent. Suppressed opt-outs are
 * recorded by the pipeline, not dropped here.
 */
const NUDGES = {
    firstVehicle1h: {
        eventKey: 'nudge_first_vehicle_1h',
        title: 'Create your tag in 2 minutes',
        body: 'Add your vehicle and print your SancharTag — scanners can reach you the moment it’s on the glass.',
        deepLink: '/add-vehicle',
    },
    firstVehicle3d: {
        eventKey: 'nudge_first_vehicle_3d',
        title: 'Your vehicle is still unreachable',
        body: 'A wrongly parked car gets towed; a SancharTag gets a call. Two minutes to set yours up.',
        deepLink: '/add-vehicle',
    },
    testTag14d: {
        eventKey: 'nudge_test_tag',
        title: 'Test your tag',
        body: 'Scan your own sticker once to make sure it works — it takes ten seconds.',
        deepLink: '/vehicles',
    },
    winback30: {
        eventKey: 'winback_30d',
        title: 'Your SancharTag is still watching',
        body: 'Scans and messages reach you even when the app is closed. Open it to check in.',
        deepLink: '/',
    },
};

const sendNudge = (userId, nudge) => notifyUser({
    userId,
    eventKey: nudge.eventKey,
    dedupeKey: `lifecycle:${nudge.eventKey}:${userId}`, // once ever per user
    title: nudge.title,
    body: nudge.body,
    deepLink: nudge.deepLink,
    channels: ['push', 'inapp'],
    pref: 'systemUpdates', // lifecycle is never transactional
});

// "Signed up, no vehicle yet" — T+1h and T+3d angles.
const runNoVehicleNudges = async (now = Date.now()) => {
    const windows = [
        // 1h window is bounded below by the 3d threshold: a user first seen
        // by the scanner inside 3d territory gets ONE message, not two.
        { nudge: NUDGES.firstVehicle1h, createdAt: { $lte: new Date(now - 1 * HOUR), $gt: new Date(now - 3 * DAY) } },
        { nudge: NUDGES.firstVehicle3d, createdAt: { $lte: new Date(now - 3 * DAY) } },
    ];
    let sends = 0;
    for (const { nudge, createdAt } of windows) {
        const users = await UserModel.find(
            { vehicleCount: 0, status: 'active', createdAt },
            { userId: 1 },
        ).limit(BATCH).lean();
        for (const { userId } of users) {
            const out = await sendNudge(userId, nudge);
            if (out.inapp === 'delivered') sends += 1;
        }
    }
    if (sends) logger.info('lifecycle no-vehicle nudges', { sends });
};

// "Vehicle created ≥14d ago, tag never scanned" — test-your-tag.
const runTestTagNudges = async (now = Date.now()) => {
    const ownerIds = await VehicleModel.distinct('userId', {
        isActive: true,
        createdAt: { $lte: new Date(now - 14 * DAY) },
    });
    if (!ownerIds.length) return;
    const users = await UserModel.find(
        { userId: { $in: ownerIds }, status: 'active', lastScanAt: null },
        { userId: 1 },
    ).limit(BATCH).lean();
    let sends = 0;
    for (const { userId } of users) {
        const out = await sendNudge(userId, NUDGES.testTag14d);
        if (out.inapp === 'delivered') sends += 1;
    }
    if (sends) logger.info('lifecycle test-tag nudges', { sends });
};

// Dormant 30d — push attempt + inbox (WhatsApp joins in phase D, where
// winbacks really work: push tokens die, WhatsApp numbers don't).
const runWinbackNudges = async (now = Date.now()) => {
    const users = await UserModel.find(
        { status: 'active', lastActiveAt: { $lte: new Date(now - 30 * DAY) } },
        { userId: 1 },
    ).limit(BATCH).lean();
    let sends = 0;
    for (const { userId } of users) {
        const out = await sendNudge(userId, NUDGES.winback30);
        if (out.inapp === 'delivered') sends += 1;
    }
    if (sends) logger.info('lifecycle winback nudges', { sends });
};

module.exports = { runNoVehicleNudges, runTestTagNudges, runWinbackNudges, NUDGES };
