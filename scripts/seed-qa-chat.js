/* eslint-disable no-console */
// Visual-QA seed: one active interaction for the UI QA account with every
// chat-redesign element — multi-day thread (date chips), tight sender runs
// (grouping), a reply quote, a call marker, and a real R2 image. Goes through
// messageService.sendMessage so seq/cursor/dedupe invariants hold.
require('dotenv').config();
const mongoose = require('mongoose');
const sharp = require('sharp');

const QA_PHONE = '9999000111';

(async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/userModel');
    const Vehicle = require('../models/vehicleModel');
    const interactionService = require('../dbServices/interactionService');
    const messageService = require('../services/messageService');
    const mediaService = require('../services/mediaService');

    const owner = await User.findOne({ phoneNumber: new RegExp(QA_PHONE) }).lean();
    if (!owner) throw new Error('QA owner not found');

    let vehicle = await Vehicle.findOne({ userId: owner.userId }).lean();
    if (!vehicle) {
        vehicle = (await Vehicle.create({
            vehicleId: `veh_qa_${Date.now().toString(36)}`,
            tagId: `tag_qa_${Date.now().toString(36)}`,
            userId: owner.userId,
            vehicleName: 'White Creta',
            vehicleNumber: 'DL 3C QA 1234',
            vehicleType: 'Car',
        })).toObject();
    }

    const interaction = await interactionService.create({
        userId: owner.userId,
        vehicleId: vehicle.vehicleId,
        type: 'Wrong Parking',
        contactType: 'chat',
        status: 'active',
        scanner: {
            phoneNumber: '+919876500222',
            phoneVerified: true,
            name: 'Ravi Kumar',
            capturedAt: new Date(),
        },
    });
    const id = interaction.interactionId;
    const send = (senderRole, text, extra = {}) => messageService.sendMessage({
        interactionId: id,
        senderRole,
        text,
        asOwnerUserId: senderRole === 'owner' ? owner.userId : null,
        ...extra,
    });

    const { message: s1 } = await send('scanner', "Hi! Is this your white Creta? It's blocking my gate");
    await send('scanner', 'I need to leave in about 10 minutes, please');
    await send('owner', 'So sorry! I stepped into a meeting');
    await send('owner', 'Moving it in 2 minutes', {
        replyTo: { messageId: s1.messageId, senderRole: 'scanner', snippet: s1.text.slice(0, 140) },
    });
    await send('owner', 'Voice call', { type: 'call' });

    // A plausible "photo" (gate + car) so the viewer verification shows real
    // pixels, pushed through the exact prod pipeline: sharp strip → R2 →
    // image message with blurhash + signed URL.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8ec9f5"/><stop offset="1" stop-color="#e8f4fd"/></linearGradient></defs>
      <rect width="1200" height="620" fill="url(#sky)"/>
      <circle cx="980" cy="140" r="70" fill="#FFD66B"/>
      <rect y="620" width="1200" height="280" fill="#9a9aa2"/>
      <rect x="80" y="240" width="420" height="380" fill="#d9633b"/>
      <rect x="120" y="290" width="150" height="330" fill="#7a3e22"/>
      <rect x="300" y="300" width="160" height="120" fill="#fff" opacity="0.85"/>
      <rect x="560" y="470" width="520" height="170" rx="40" fill="#f2f2f4" stroke="#333" stroke-width="6"/>
      <rect x="640" y="400" width="340" height="120" rx="36" fill="#f2f2f4" stroke="#333" stroke-width="6"/>
      <circle cx="680" cy="650" r="52" fill="#222"/><circle cx="960" cy="650" r="52" fill="#222"/>
      <text x="600" y="840" font-family="Helvetica" font-size="44" fill="#fff" text-anchor="middle">QA PHOTO — gate blocked</text>
    </svg>`;
    const photo = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
    const { buffer, media } = await mediaService.processImage(photo);
    const key = await mediaService.store(id, buffer);
    await send('scanner', '', { type: 'image', media: { ...media, key } });
    await send('scanner', "That's the gate it is blocking");

    // Backdate the opening exchange to yesterday so the thread renders a
    // "Yesterday" chip above seq 1-2 and "Today" above the rest.
    const yday = new Date(Date.now() - 26 * 3600 * 1000);
    await mongoose.connection.collection('chatmessages').updateMany(
        { conversationId: id, seq: { $lte: 2 } },
        { $set: { createdAt: yday } },
    );
    await mongoose.connection.collection('interactions').updateOne(
        { interactionId: id },
        { $set: { createdAt: yday } },
    );

    console.log('SEEDED', id);
    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
