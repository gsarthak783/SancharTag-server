const db = require('./helpers/db');
const InteractionModel = require('../models/interactionModel');
const ChatMessageModel = require('../models/chatMessageModel');
const messageService = require('../services/messageService');
const mediaService = require('../services/mediaService');
const errorCodes = require('../config/errorCodes');
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
        scanner: { phoneNumber: '+919876500010', phoneVerified: true },
    });
    return interactionId;
};

describe('voice notes (feature 04 v2.5)', () => {
    describe('sniffAudio — container magic, never the client mimetype', () => {
        test('webm/EBML', () => {
            const buf = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
            expect(mediaService.sniffAudio(buf)).toEqual({ mime: 'audio/webm', ext: 'webm' });
        });
        test('mp4/m4a ftyp', () => {
            const buf = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypM4A '), Buffer.alloc(8)]);
            expect(mediaService.sniffAudio(buf)).toEqual({ mime: 'audio/mp4', ext: 'm4a' });
        });
        test('ogg', () => {
            const buf = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]);
            expect(mediaService.sniffAudio(buf)).toEqual({ mime: 'audio/ogg', ext: 'ogg' });
        });
        test('renamed junk is rejected', () => {
            // errorCodes throws plain objects, not Errors — assert identity.
            expect.assertions(2);
            try {
                mediaService.sniffAudio(Buffer.from('MZ\x90\x00 definitely not audio'));
            } catch (e) {
                expect(e).toBe(errorCodes.VOICE_INVALID);
            }
            try {
                mediaService.sniffAudio(Buffer.alloc(4));
            } catch (e) {
                expect(e).toBe(errorCodes.VOICE_INVALID);
            }
        });
    });

    test('voice message persists media descriptor and reads back on the wire', async () => {
        const interactionId = await makeInteraction();
        const { message } = await messageService.sendMessage({
            interactionId,
            senderRole: 'scanner',
            text: '',
            type: 'voice',
            clientId: 'v-1',
            media: { key: `chat/${interactionId}/voice-abc.webm`, mime: 'audio/webm', bytes: 42_000, dur: 17 },
        });
        expect(message.type).toBe('voice');
        expect(message.media.dur).toBe(17);
        expect(message.media.mime).toBe('audio/webm');

        const row = await ChatMessageModel.findOne({ conversationId: interactionId, clientId: 'v-1' }).lean();
        expect(row.media.key).toMatch(/voice-abc\.webm$/);
        expect(row.text).toBe('');
    });

    test('lastMessage preview says voice, not an empty string', async () => {
        const interactionId = await makeInteraction();
        await messageService.sendMessage({
            interactionId,
            senderRole: 'scanner',
            text: '',
            type: 'voice',
            clientId: 'v-2',
            media: { key: 'k', mime: 'audio/mp4', bytes: 1000, dur: 5 },
        });
        const doc = await InteractionModel.findOne({ interactionId }).lean();
        expect(doc.lastMessage).toBe('🎤 Voice message');
    });

    test('voice retries stay exactly-once (same clientId → one row)', async () => {
        const interactionId = await makeInteraction();
        const args = {
            interactionId,
            senderRole: 'owner',
            asOwnerUserId: 'user_owner1',
            text: '',
            type: 'voice',
            clientId: 'v-3',
            media: { key: 'k2', mime: 'audio/webm', bytes: 900, dur: 3 },
        };
        const first = await messageService.sendMessage(args);
        const second = await messageService.sendMessage(args);
        expect(second.duplicate).toBe(true);
        expect(second.message.messageId).toBe(first.message.messageId);
        expect(await ChatMessageModel.countDocuments({ conversationId: interactionId })).toBe(1);
    });
});
