/**
 * Backfill engagement counters (feature 02): pre-engine users have no
 * vehicleCount field at all, and {vehicleCount: 0} does not match a missing
 * field — lifecycle segments would skip them. Also seeds lastActiveAt from
 * updatedAt so winback doesn't fire on day one for everyone.
 * Safe to re-run. Run: node scripts/backfill-counters.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Vehicle = require('../models/vehicleModel');

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const users = await User.find({}, { userId: 1, updatedAt: 1, lastActiveAt: 1, vehicleCount: 1 }).lean();
    const counts = await Vehicle.aggregate([
        { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]);
    const byUser = new Map(counts.map((c) => [c._id, c.n]));

    let updated = 0;
    for (const user of users) {
        const set = {};
        const actual = byUser.get(user.userId) || 0;
        if (user.vehicleCount === undefined || user.vehicleCount !== actual) set.vehicleCount = actual;
        if (!user.lastActiveAt) set.lastActiveAt = user.updatedAt || new Date();
        if (Object.keys(set).length) {
            await User.updateOne({ userId: user.userId }, { $set: set });
            updated += 1;
        }
    }
    console.log(`users checked: ${users.length}, updated: ${updated}`);
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
