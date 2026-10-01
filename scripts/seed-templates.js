/**
 * Default campaign/lifecycle templates (feature 02) — written for the phone
 * notification tray: titles ≤ ~40 chars, bodies ≤ ~110, one purposeful
 * emoji, {{name}}/{{vehicleCount}} personalization, real deep links.
 * Idempotent: $setOnInsert only — console edits are never clobbered.
 * Run: node scripts/seed-templates.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Template = require('../models/templateModel');

const T = (key, name, category, pushTitle, pushBody, deepLink, variables = ['name']) => ({
    key,
    name,
    category,
    channels: {
        push: { title: pushTitle, body: pushBody, channelId: 'default' },
        inapp: { title: pushTitle, body: pushBody, deepLink },
    },
    variables,
    active: true,
    createdBy: 'seed',
});

const TEMPLATES = [
    T('welcome_aboard', 'Welcome aboard', 'lifecycle',
        'Welcome to SancharTag, {{name}} 👋',
        'Your number stays private, your vehicle stays reachable. Set up your first tag — it takes two minutes.',
        '/add-vehicle'),

    T('print_tag_kit', 'Print your tag kit', 'lifecycle',
        'Your sticker kit is ready to print 🖨️',
        '{{name}}, your QR tag kit is one tap away — print at home, stick it on, done. Scanners reach you, never your number.',
        '/vehicles'),

    T('test_your_tag', 'Test your tag', 'lifecycle',
        'Give your tag a 10-second test 📲',
        'Scan your own sticker once — see exactly what strangers see, and make sure alerts reach you instantly.',
        '/vehicles'),

    T('whats_new_chat', "What's new: smarter chat", 'campaign',
        'Ticks, typing and instant chat ✓✓',
        'See when scanners read your replies, watch them type, and never lose a message — even with patchy network.',
        '/history'),

    T('emergency_contact_nudge', 'Add an emergency contact', 'lifecycle',
        'One number can save the day 🆘',
        '{{name}}, add an emergency contact — scanners can reach them when you can’t pick up. Thirty seconds in Settings.',
        '/settings/edit-profile'),

    T('winback_quiet_roads', 'All quiet — welcome back', 'campaign',
        'All quiet around your vehicle 🛡️',
        'No incidents while you were away. Take a moment to check your tags are still on and active.',
        '/vehicles'),

    T('festive_parking', 'Festive parking rush', 'campaign',
        'Festive rush outside? 🎉',
        'Crowded-parking season is here. A SancharTag on the windshield means a polite call — not a tow truck.',
        '/vehicles', []),

    T('refer_a_friend', 'Refer a friend', 'campaign',
        'Know a chronic double-parker? 😄',
        'Gift them peace of mind — tell them about SancharTag and keep your street drama-free.',
        '/', []),
];

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    let created = 0;
    let kept = 0;
    for (const tpl of TEMPLATES) {
        const res = await Template.updateOne(
            { key: tpl.key },
            { $setOnInsert: tpl },
            { upsert: true },
        );
        if (res.upsertedCount) created += 1; else kept += 1;
    }
    console.log(`templates seeded: ${created} created, ${kept} already existed (left untouched)`);
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
