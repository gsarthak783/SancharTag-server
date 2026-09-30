const db = require('./helpers/db');
const InteractionModel = require('../models/interactionModel');
const ChatMessageModel = require('../models/chatMessageModel');
const messageService = require('../services/messageService');
const chatMessageService = require('../dbServices/chatMessageService');
const interactionService = require('../dbServices/interactionService');
const { generateInteractionId } = require('../utils/ids');

beforeAll(db.connect);
afterAll(db.disconnect);

const makeInteraction = async () => {
    const interactionId = generateInteractionId();
    await InteractionModel.create({
        interactionId,
        userId: 'user_owner1',
        vehicleId: 'veh_1',
        status: 'active',
        contactType: 'chat',
        scanner: { phoneNumber: '+919876500009', phoneVerified: true },
    });
    return interactionId;
};

describe('chat v2 protocol core (feature 04)', () => {
    test('duplicate msg:send retries collapse to ONE row with the original seq', async () => {
        const interactionId = await makeInteraction();
        const args = {
            interactionId, senderRole: 'scanner', text: 'hello', clientId: 'c-1',
        };
        const first = await messageService.sendMessage(args);
        const second = await messageService.sendMessage(args); // lost-ack retry

        expect(first.duplicate).toBe(false);
        expect(second.duplicate).toBe(true);
        expect(second.message.messageId).toBe(first.message.messageId);
        expect(second.message.seq).toBe(first.message.seq);
        expect(await ChatMessageModel.countDocuments({ conversationId: interactionId })).toBe(1);
        // The retry must not have burned a seq on the conversation.
        const doc = await InteractionModel.findOne({ interactionId }).lean();
        expect(doc.seq).toBe(1);
    });

    test('seq is monotone across senders; unread math holds; markRead jumps the cursor', async () => {
        const interactionId = await makeInteraction();
        await messageService.sendMessage({ interactionId, senderRole: 'scanner', text: 's1', clientId: 's1' });
        await messageService.sendMessage({ interactionId, senderRole: 'owner', text: 'o1', clientId: 'o1' });
        await messageService.sendMessage({ interactionId, senderRole: 'scanner', text: 's2', clientId: 's2' });

        let doc = await InteractionModel.findOne({ interactionId }).lean();
        expect(doc.seq).toBe(3);
        expect(doc.unreadCount).toBe(2); // two scanner messages, owner unread

        const read = await interactionService.markRead(interactionId);
        expect(read.unreadCount).toBe(0);
        expect(read.receipts.owner.read).toBe(3);
    });

    test('receipt cursors never move backwards ($max)', async () => {
        const interactionId = await makeInteraction();
        for (const n of [1, 2, 3, 4, 5]) {
            await messageService.sendMessage({ interactionId, senderRole: 'owner', text: `m${n}`, clientId: `m${n}` });
        }
        await messageService.advanceReceipt({ interactionId, role: 'scanner', kind: 'read', upToSeq: 4 });
        await messageService.advanceReceipt({ interactionId, role: 'scanner', kind: 'read', upToSeq: 2 }); // stale replay

        const doc = await InteractionModel.findOne({ interactionId }).lean();
        expect(doc.receipts.scanner.read).toBe(4);
    });

    test('pagination is gapless across a live insert', async () => {
        const interactionId = await makeInteraction();
        for (let n = 1; n <= 50; n += 1) {
            await messageService.sendMessage({ interactionId, senderRole: 'owner', text: `m${n}`, clientId: `p${n}` });
        }
        const page1 = await chatMessageService.listPage(interactionId, { limit: 40 });
        // A message lands while the user scrolls back — must not shift pages.
        await messageService.sendMessage({ interactionId, senderRole: 'owner', text: 'live', clientId: 'live' });
        const page2 = await chatMessageService.listPage(interactionId, { beforeSeq: page1[0].seq, limit: 40 });

        const seqs = [...page2, ...page1].map((m) => m.seq);
        expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });

    test('sends into a non-active session refuse without minting a seq', async () => {
        const interactionId = await makeInteraction();
        await messageService.sendMessage({ interactionId, senderRole: 'owner', text: 'hi', clientId: 'x1' });
        await InteractionModel.updateOne({ interactionId }, { $set: { status: 'resolved' } });

        await expect(messageService.sendMessage({
            interactionId, senderRole: 'owner', text: 'late', clientId: 'x2',
        })).rejects.toMatchObject({ code: 'SESSION_ENDED' });
        const doc = await InteractionModel.findOne({ interactionId }).lean();
        expect(doc.seq).toBe(1);

        // …but the lost-ack retry of a message SENT before resolution still
        // reproduces its ack instead of erroring.
        const replay = await messageService.sendMessage({
            interactionId, senderRole: 'owner', text: 'hi', clientId: 'x1',
        });
        expect(replay.duplicate).toBe(true);
        expect(replay.message.seq).toBe(1);
    });
});
