const Pulse = require('@pulsecron/pulse').default;
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { pollExpoReceipts } = require('./expoReceipts');
const { runNoVehicleNudges, runTestTagNudges, runWinbackNudges } = require('./lifecycle');

// Mongo-backed scheduler (Pulse = maintained Agenda fork): zero new infra,
// jobs survive restarts. The seam is this module — swap to BullMQ+Redis here
// if volume ever demands it.
let pulse = null;

const initJobs = async () => {
    pulse = new Pulse({
        mongo: mongoose.connection.db,
        db: { collection: 'scheduledJobs' },
        processEvery: '1 minute',
        maxConcurrency: 5,
    });

    pulse.define('expo-receipts', pollExpoReceipts, { shouldSaveResult: false });
    // Lifecycle segment scans (phase B): the query re-checks the condition
    // at fire time; once-ever dedupe keys make re-scans idempotent.
    pulse.define('lifecycle-no-vehicle', () => runNoVehicleNudges(), { shouldSaveResult: false });
    pulse.define('lifecycle-test-tag', () => runTestTagNudges(), { shouldSaveResult: false });
    pulse.define('lifecycle-winback', () => runWinbackNudges(), { shouldSaveResult: false });

    await pulse.start();
    // Push sends return tickets, not outcomes — poll receipts to learn
    // delivered/failed and prune dead device tokens.
    await pulse.every('15 minutes', 'expo-receipts');
    await pulse.every('30 minutes', 'lifecycle-no-vehicle');
    await pulse.every('24 hours', 'lifecycle-test-tag');
    await pulse.every('24 hours', 'lifecycle-winback');
    logger.info('jobs started (pulse)');
    return pulse;
};

const stopJobs = async () => {
    if (pulse) await pulse.stop();
};

module.exports = { initJobs, stopJobs };
