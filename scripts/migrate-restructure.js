/**
 * One-time migration: v1 data → restructured backend.
 * Run manually: node scripts/migrate-restructure.js
 *
 * - normalizes user/blocked phone numbers to E.164
 * - dedupes users sharing a phone (keeps newest, archives the rest)
 * - backfills jwtSalt on users that predate sessions
 * - drops legacy fields on vehicles (ownerName/ownerContactNumber)
 * - syncs indexes (unique phoneNumber, unique tagId, list indexes)
 *
 * If the v1 dev data is disposable, dropping the collections is simpler.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config/config');
const { normalizePhone } = require('../utils/phone');
const { generateJwtSalt } = require('../utils/ids');
const User = require('../models/userModel');
const Vehicle = require('../models/vehicleModel');
const Interaction = require('../models/interactionModel');
const { DeletedUser } = require('../models/archiveModels');

const run = async () => {
    await mongoose.connect(config.database);
    console.log('connected');

    // 1. Normalize phones + backfill salts
    const users = await User.find({}).select('+jwtSalt +blockedNumbers').lean();
    let fixedPhones = 0;
    for (const user of users) {
        const updates = {};
        const normalized = normalizePhone(user.phoneNumber);
        if (normalized && normalized !== user.phoneNumber) {
            updates.phoneNumber = normalized;
            fixedPhones += 1;
        }
        if (!user.jwtSalt) updates.jwtSalt = generateJwtSalt();
        if (user.blockedNumbers?.length) {
            updates.blockedNumbers = user.blockedNumbers
                .map((entry) => ({ ...entry, phoneNumber: normalizePhone(entry.phoneNumber) || entry.phoneNumber }));
        }
        if (Object.keys(updates).length) {
            await User.updateOne({ _id: user._id }, { $set: updates });
        }
    }
    console.log(`users: ${users.length} scanned, ${fixedPhones} phones normalized`);

    // 2. Dedupe users by phone — keep the most recently created
    const dupes = await User.aggregate([
        { $group: { _id: '$phoneNumber', ids: { $push: '$_id' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
    ]);
    for (const group of dupes) {
        const docs = await User.find({ _id: { $in: group.ids } })
            .select('+jwtSalt +blockedNumbers +pushToken').sort({ createdAt: -1 }).lean();
        const [, ...losers] = docs;
        for (const loser of losers) {
            await DeletedUser.create({ ...loser, deletedAt: new Date(), deletedBy: 'migration:dedupe' });
            await User.deleteOne({ _id: loser._id });
        }
        console.log(`deduped ${group._id}: kept 1, archived ${losers.length}`);
    }

    // 3. Drop legacy vehicle fields that leaked owner identity
    const cleaned = await Vehicle.updateMany(
        {},
        { $unset: { ownerName: 1, ownerContactNumber: 1 } },
        { strict: false },
    );
    console.log(`vehicles: legacy owner fields removed on ${cleaned.modifiedCount}`);

    // 4. Build indexes (fails loudly if data still violates uniqueness)
    for (const model of [User, Vehicle, Interaction]) {
        await model.syncIndexes();
        console.log(`indexes synced: ${model.modelName}`);
    }

    await mongoose.disconnect();
    console.log('done');
};

run().catch((err) => {
    console.error('migration failed:', err.message);
    process.exit(1);
});
