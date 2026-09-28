const NotificationModel = require('../models/notificationModel');
const DeliveryModel = require('../models/deliveryModel');
const UserModel = require('../models/userModel');
const logger = require('../utils/logger');
// Module object (not destructured): sockets ↔ services require cycle.
const sockets = require('../sockets');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const INBOX_TTL_DAYS = 90;

const isExpoToken = (t) => typeof t === 'string' && t.startsWith('ExponentPushToken[');

// All of a user's live tokens: the multi-device array, falling back to the
// legacy single pushToken until every client has re-registered.
const tokensForUser = (user) => {
    const fromArray = (user.expoTokens || []).map((e) => e.token).filter(isExpoToken);
    if (fromArray.length) return [...new Set(fromArray)];
    return isExpoToken(user.pushToken) ? [user.pushToken] : [];
};

const removeToken = async (token) => {
    await UserModel.updateMany(
        { 'expoTokens.token': token },
        { $pull: { expoTokens: { token } } },
    );
    await UserModel.updateMany({ pushToken: token }, { $unset: { pushToken: 1 } });
    logger.info('pruned dead expo token');
};

// Low-level Expo send. Returns [{id, token}] ticket pairs (send ≠ outcome —
// the receipts poller settles delivered/failed later). Never throws.
const pushToExpo = async (tokens, { title, body, data = {}, channelId = 'default' }) => {
    const messages = tokens.map((to) => ({
        to, sound: 'default', title, body, data, priority: 'high', channelId,
    }));
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(messages),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const json = await response.json();
        const tickets = [];
        (json.data || []).forEach((ticket, i) => {
            if (ticket.status === 'ok') {
                tickets.push({ id: ticket.id, token: tokens[i] });
            } else if (ticket.details?.error === 'DeviceNotRegistered') {
                // Dead at send time — prune immediately, don't wait for receipts.
                removeToken(tokens[i]).catch(() => { });
            }
        });
        return { tickets, error: null };
    } catch (error) {
        logger.error('expo push failed', { error: error.message });
        return { tickets: [], error: error.message };
    }
};

// Insert the delivery row; a duplicate-key error means this exact send
// already happened (or is happening) — the caller must not send again.
const claimDelivery = async ({ userId, channel, eventKey, dedupeKey, campaignId }) => {
    try {
        return await DeliveryModel.create({ userId, channel, eventKey, dedupeKey, campaignId });
    } catch (err) {
        if (err?.code === 11000) return null;
        throw err;
    }
};

/**
 * THE send path (feature 02, phase A). One logical notification to one user:
 *  - dedupeKey + the unique delivery index = idempotency (double events,
 *    retries and races collapse to one send per channel)
 *  - inapp: inbox insert + live socket emit for the bell
 *  - push: every registered device; tickets recorded for receipt polling
 * Transactional sends bypass every future gate (caps/quiet hours land in
 * phase D behind this same signature). Never throws.
 */
const notifyUser = async ({
    userId,
    eventKey,
    dedupeKey,
    title,
    body,
    data = {},
    deepLink = null,
    channels = ['push', 'inapp'],
    channelId = 'default',
    campaignId = null,
}) => {
    const outcome = { push: 'skipped', inapp: 'skipped' };
    try {
        if (channels.includes('inapp')) {
            const delivery = await claimDelivery({ userId, channel: 'inapp', eventKey, dedupeKey, campaignId });
            if (delivery) {
                const doc = await NotificationModel.create({
                    userId,
                    type: eventKey,
                    title,
                    body,
                    deepLink,
                    data,
                    campaignId,
                    expiresAt: new Date(Date.now() + INBOX_TTL_DAYS * 24 * 3600 * 1000),
                });
                await delivery.updateOne({ $set: { status: 'delivered', sentAt: new Date(), resolvedAt: new Date() } });
                sockets.emitToUser(userId, 'notification', {
                    notificationId: doc._id.toString(),
                    type: eventKey,
                    title,
                    body,
                    deepLink,
                    data,
                    createdAt: doc.createdAt,
                });
                outcome.inapp = 'delivered';
            } else {
                outcome.inapp = 'duplicate';
            }
        }

        if (channels.includes('push')) {
            const user = await UserModel.findOne({ userId })
                .select('+expoTokens +pushToken notificationPreferences')
                .lean();
            const tokens = user ? tokensForUser(user) : [];
            if (!tokens.length) {
                outcome.push = 'no_tokens';
            } else {
                const delivery = await claimDelivery({ userId, channel: 'push', eventKey, dedupeKey, campaignId });
                if (delivery) {
                    const { tickets, error } = await pushToExpo(tokens, { title, body, data, channelId });
                    await delivery.updateOne({
                        $set: tickets.length
                            ? { status: 'sent', sentAt: new Date(), tickets }
                            : { status: 'failed', error: error || 'no tickets returned' },
                    });
                    outcome.push = tickets.length ? 'sent' : 'failed';
                } else {
                    outcome.push = 'duplicate';
                }
            }
        }
    } catch (error) {
        logger.error('notifyUser failed', { error: error.message, eventKey, userId });
    }
    return outcome;
};

/**
 * Legacy single-token helper — kept for callers that carry their own token;
 * new code goes through notifyUser. Records no delivery.
 */
const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
    if (!isExpoToken(expoPushToken)) {
        logger.warn('push skipped: invalid Expo token format');
        return { success: false, error: 'Invalid token format' };
    }
    const { tickets, error } = await pushToExpo([expoPushToken], { title, body, data });
    return tickets.length ? { success: true, result: tickets } : { success: false, error };
};

module.exports = { notifyUser, sendPushNotification, pushToExpo, removeToken, tokensForUser };
