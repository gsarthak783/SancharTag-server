const DeliveryModel = require('../models/deliveryModel');
const { removeToken } = require('../services/notificationService');
const logger = require('../utils/logger');

const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const MIN_AGE_MS = 15 * 60 * 1000;       // give Expo time to produce receipts
const GIVE_UP_MS = 48 * 3600 * 1000;     // receipts are kept ~24h; stop asking
const BATCH = 100;

/**
 * Resolve push tickets → delivered/failed (feature 02). DeviceNotRegistered
 * at receipt stage prunes the token, exactly like at send stage.
 */
const pollExpoReceipts = async () => {
    const now = Date.now();
    const pending = await DeliveryModel.find({
        channel: 'push',
        status: 'sent',
        sentAt: { $lte: new Date(now - MIN_AGE_MS) },
        'tickets.0': { $exists: true },
    }).limit(BATCH).lean();
    if (!pending.length) return;

    const ticketToDelivery = new Map();
    const ids = [];
    for (const delivery of pending) {
        for (const ticket of delivery.tickets) {
            ids.push(ticket.id);
            ticketToDelivery.set(ticket.id, { delivery, token: ticket.token });
        }
    }

    let receipts = {};
    try {
        const response = await fetch(RECEIPTS_URL, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        });
        receipts = (await response.json()).data || {};
    } catch (error) {
        logger.error('receipt poll failed', { error: error.message });
        return; // transient — next run retries the same batch
    }

    const outcomes = new Map(); // deliveryId → { ok, errors: [] }
    for (const [ticketId, entry] of ticketToDelivery) {
        const receipt = receipts[ticketId];
        const deliveryId = entry.delivery._id.toString();
        if (!outcomes.has(deliveryId)) outcomes.set(deliveryId, { ok: 0, errors: [], total: 0 });
        const agg = outcomes.get(deliveryId);
        agg.total += 1;
        if (!receipt) {
            // Not ready yet — unless we've waited past Expo's retention.
            if (now - new Date(entry.delivery.sentAt).getTime() > GIVE_UP_MS) {
                agg.errors.push('receipt never returned');
            } else {
                agg.pendingSome = true;
            }
        } else if (receipt.status === 'ok') {
            agg.ok += 1;
        } else {
            agg.errors.push(receipt.details?.error || receipt.message || 'unknown');
            if (receipt.details?.error === 'DeviceNotRegistered') {
                await removeToken(entry.token).catch(() => { });
            }
        }
    }

    for (const [deliveryId, agg] of outcomes) {
        if (agg.pendingSome) continue; // wait for the rest; next run finishes it
        await DeliveryModel.updateOne(
            { _id: deliveryId },
            {
                $set: agg.ok > 0
                    ? { status: 'delivered', resolvedAt: new Date() }
                    : { status: 'failed', resolvedAt: new Date(), error: agg.errors.join('; ') || 'no receipts' },
            },
        );
    }
    logger.debug('receipts resolved', { deliveries: outcomes.size });
};

module.exports = { pollExpoReceipts };
