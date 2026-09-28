/**
 * One-time backfill: give every vehicle without a shortCode one (QR print
 * kit, feature 07). Safe to re-run — only touches docs missing the field.
 * Run: node scripts/backfill-shortcodes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Vehicle = require('../models/vehicleModel');
const { generateShortCode } = require('../utils/ids');

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const missing = await Vehicle.find({ shortCode: { $exists: false } }, { vehicleId: 1 }).lean();
    console.log(`vehicles without shortCode: ${missing.length}`);

    let done = 0;
    for (const { vehicleId } of missing) {
        for (let attempt = 0; ; attempt += 1) {
            try {
                await Vehicle.updateOne({ vehicleId }, { $set: { shortCode: generateShortCode() } });
                done += 1;
                break;
            } catch (err) {
                const dup = err?.code === 11000 && err?.keyPattern?.shortCode;
                if (!dup || attempt >= 3) throw err;
            }
        }
    }
    console.log(`backfilled: ${done}`);
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
