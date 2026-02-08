const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
let expo = new Expo();

/**
 * Send push notifications to an array of Expo push tokens.
 * 
 * @param {string} pushToken - The recipient's Expo push token
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} data - Optional data payload (e.g., interactionId)
 */
const sendPushNotification = async (pushToken, title, body, data = {}) => {
    console.log(`Sending notification to token: ${pushToken}`);
    if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`Push token ${pushToken} is not a valid Expo push token`);
        return;
    }

    const messages = [];
    messages.push({
        to: pushToken,
        sound: 'default',
        title: title,
        body: body,
        data: data,
        priority: 'high',
        channelId: 'default', // Required for Android 8.0+
        vibrate: [0, 250, 250, 250], // Vibration pattern
    });

    // The Expo push notification service accepts batches of notifications so
    // that you don't need to send 1000 requests to send 1000 notifications.
    // We recommend you batch your notifications to reduce the number of requests
    // and to compress them (notifications with similar content will get
    // compressed).
    let chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    (async () => {
        // Send the chunks to the Expo push notification service. There are
        // different strategies you could use. A simple one is to send one chunk at a
        // time, which nicely spreads the load out over time:
        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                console.log('Notification Ticket Chunk:', ticketChunk);
                tickets.push(...ticketChunk);
                // NOTE: If a ticket contains an error code in ticket.details.error, you
                // must handle it appropriately. The error codes are listed in the Expo
                // documentation:
                // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
            } catch (error) {
                console.error(error);
            }
        }
    })();
};

module.exports = { sendPushNotification };
