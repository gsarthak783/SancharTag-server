/**
 * Chat v2 migration: embedded interaction.messages[] → chatmessages
 * collection with seq backfill; interactions gain seq + receipt cursors.
 * Old history is marked fully delivered/read for both sides (the ticks only
 * matter going forward). Safe to re-run: migrated docs (messages unset) are
 * skipped, and re-inserts collapse on the unique clientId index.
 * Run: node scripts/migrate-messages.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Interaction = require('../models/interactionModel');
const ChatMessage = require('../models/chatMessageModel');

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const cursor = Interaction.find(
        { messages: { $exists: true } },
        { interactionId: 1, messages: 1, unreadCount: 1 },
    ).lean().cursor();

    let migrated = 0;
    let messageCount = 0;
    for await (const doc of cursor) {
        const messages = doc.messages || [];
        if (messages.length) {
            const rows = messages.map((m, i) => ({
                messageId: m.messageId,
                conversationId: doc.interactionId,
                senderRole: m.senderRole,
                // Legacy rows had no client key — the messageId is unique and
                // stable, which is all idempotent re-runs need.
                clientId: m.messageId,
                seq: i + 1,
                type: m.type || 'text',
                text: m.text,
                createdAt: m.timestamp,
                updatedAt: m.timestamp,
            }));
            try {
                await ChatMessage.insertMany(rows, { ordered: false });
            } catch (err) {
                if (err?.code !== 11000) throw err; // re-run: duplicates are fine
            }
            messageCount += rows.length;
        }
        const seq = messages.length;
        await Interaction.updateOne(
            { interactionId: doc.interactionId },
            {
                $set: {
                    seq,
                    receipts: {
                        owner: { delivered: seq, read: seq },
                        scanner: { delivered: seq, read: seq },
                    },
                    unreadCount: 0,
                },
                $unset: { messages: 1 },
            },
        );
        migrated += 1;
    }
    console.log(`interactions migrated: ${migrated}, messages moved: ${messageCount}`);
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
