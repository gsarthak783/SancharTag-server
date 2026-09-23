const logger = require('../utils/logger');

/**
 * Send a push notification via Expo's Push API.
 * Fire-and-forget friendly: never throws, returns { success, ... }.
 * (Receipt checking / batching via expo-server-sdk is a planned upgrade.)
 */
const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
    if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) {
        logger.warn('push skipped: invalid Expo token format');
        return { success: false, error: 'Invalid token format' };
    }

    const message = {
        to: expoPushToken,
        sound: 'default',
        title,
        body,
        data,
        priority: 'high',
        channelId: 'default',
    };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const result = await response.json();
        logger.debug('push sent', { status: response.status });
        return { success: true, result };
    } catch (error) {
        logger.error('push send failed', { error: error.message });
        return { success: false, error: error.message };
    }
};

module.exports = { sendPushNotification };
