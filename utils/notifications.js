/**
 * Send push notifications using Expo's Push API directly via fetch.
 * This approach does NOT require Firebase Admin or FCM credentials.
 * 
 * @param {string} expoPushToken - The recipient's Expo push token (e.g., ExponentPushToken[...])
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} data - Optional data payload (e.g., interactionId)
 */
const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
    console.log(`Sending notification to token: ${expoPushToken}`);

    // Validate the token format
    if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) {
        console.error(`Invalid Expo push token: ${expoPushToken}`);
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
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });

        const result = await response.json();
        console.log('Notification Result:', JSON.stringify(result, null, 2));
        return { success: true, result };
    } catch (error) {
        console.error('Error sending notification:', error);
        return { success: false, error: error.message };
    }
};

module.exports = { sendPushNotification };
