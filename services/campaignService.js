const CampaignModel = require('../models/campaignModel');
const TemplateModel = require('../models/templateModel');
const UserModel = require('../models/userModel');
const { notifyUser } = require('./notificationService');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
const { generateId } = require('../utils/ids');

const DAY = 24 * 3600 * 1000;

// Saved segments — the audience builder's presets. Each is a plain find on
// users (the denormalized counters exist exactly for this).
const AUDIENCE_PRESETS = {
    all_active: () => ({ status: 'active' }),
    no_vehicle: () => ({ status: 'active', vehicleCount: 0 }),
    has_vehicle: () => ({ status: 'active', vehicleCount: { $gte: 1 } }),
    never_scanned: () => ({ status: 'active', vehicleCount: { $gte: 1 }, lastScanAt: null }),
    dormant_30d: (now) => ({ status: 'active', lastActiveAt: { $lte: new Date(now - 30 * DAY) } }),
    active_7d: (now) => ({ status: 'active', lastActiveAt: { $gte: new Date(now - 7 * DAY) } }),
};

// Raw queries come from superadmins only (console-enforced), but server-side
// execution operators are rejected regardless of who asks.
const FORBIDDEN_KEYS = ['$where', '$function', '$accumulator', '$expr'];
const assertSafeQuery = (query) => {
    const scan = (node) => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (FORBIDDEN_KEYS.includes(key)) throw errorCodes.VALIDATION_FAILED;
            scan(value);
        }
    };
    scan(query);
    return query;
};

const audienceFilter = (audience, now = Date.now()) => {
    if (audience.kind === 'preset') {
        const preset = AUDIENCE_PRESETS[audience.preset];
        if (!preset) throw errorCodes.VALIDATION_FAILED;
        return preset(now);
    }
    if (audience.kind === 'query') return assertSafeQuery(audience.query || {});
    if (audience.kind === 'static') return { userId: { $in: audience.userIds || [] } };
    throw errorCodes.VALIDATION_FAILED;
};

// The builder's "who would this reach?" preview.
exports.previewAudience = async (audience) => {
    const filter = audienceFilter(audience);
    const [count, sample] = await Promise.all([
        UserModel.countDocuments(filter),
        UserModel.find(filter, { userId: 1, name: 1, phoneNumber: 1, vehicleCount: 1, _id: 0 }).limit(5).lean(),
    ]);
    return { count, sample };
};

// {{name}}-style interpolation. Unknown variables render as ''.
const render = (text, user) => String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === 'name') return user.name || 'there';
    if (key === 'vehicleCount') return String(user.vehicleCount ?? 0);
    return '';
});

/**
 * Execute one campaign occurrence. Dedupe key carries the occurrence time,
 * so a recurring campaign reaches each user once PER occurrence while a
 * crashed/re-run occurrence stays idempotent.
 */
exports.runCampaign = async (campaign, occurrenceAt = new Date()) => {
    const template = await TemplateModel.findOne({ key: campaign.templateKey, active: true }).lean();
    if (!template) throw new Error(`template ${campaign.templateKey} missing or inactive`);

    const filter = audienceFilter(campaign.audience);
    const stats = { targeted: 0, sent: 0, delivered: 0, failed: 0, suppressed: 0, noTokens: 0 };
    const occ = occurrenceAt.getTime();

    const cursor = UserModel.find(filter, { userId: 1, name: 1, vehicleCount: 1, _id: 0 }).lean().cursor();
    for await (const user of cursor) {
        stats.targeted += 1;
        const content = template.channels.push || template.channels.inapp || {};
        const inapp = template.channels.inapp || content;
        const outcome = await notifyUser({
            userId: user.userId,
            eventKey: `campaign:${campaign.campaignId}`,
            dedupeKey: `campaign:${campaign.campaignId}:${occ}:${user.userId}`,
            title: render(content.title || inapp.title, user),
            body: render(content.body || inapp.body, user),
            deepLink: inapp.deepLink || null,
            channels: campaign.channels,
            channelId: content.channelId || 'default',
            campaignId: campaign.campaignId,
            pref: 'systemUpdates', // campaigns are never transactional
        });
        if (outcome.push === 'sent') stats.sent += 1;
        else if (outcome.push === 'failed') stats.failed += 1;
        else if (outcome.push === 'suppressed_optout') stats.suppressed += 1;
        else if (outcome.push === 'no_tokens') stats.noTokens += 1;
        if (outcome.inapp === 'delivered') stats.delivered += 1;
    }

    await CampaignModel.updateOne(
        { campaignId: campaign.campaignId },
        {
            $inc: Object.fromEntries(Object.entries(stats).map(([k, v]) => [`stats.${k}`, v])),
            $set: { lastRunAt: new Date() },
        },
    );
    logger.info('campaign ran', { campaignId: campaign.campaignId, ...stats });
    return stats;
};

exports.createCampaign = async (payload, actingAdmin) => {
    const schedule = payload.schedule || { kind: 'now' };
    const nextRunAt = schedule.kind === 'now' ? new Date()
        : schedule.kind === 'once' ? new Date(schedule.at)
            : exports.nextCronRun(schedule.cron);
    if (!nextRunAt || Number.isNaN(nextRunAt.getTime())) throw errorCodes.VALIDATION_FAILED;

    // Validate audience + template up front so drafts can't be scheduled broken.
    audienceFilter(payload.audience);
    const template = await TemplateModel.findOne({ key: payload.templateKey, active: true }).lean();
    if (!template) throw errorCodes.VALIDATION_FAILED;

    const campaign = await CampaignModel.create({
        campaignId: generateId('cmp'),
        name: payload.name,
        templateKey: payload.templateKey,
        channels: payload.channels?.length ? payload.channels.filter((c) => ['push', 'inapp'].includes(c)) : ['push', 'inapp'],
        audience: payload.audience,
        schedule,
        nextRunAt,
        state: 'scheduled',
        throttlePerMin: payload.throttlePerMin || 600,
        createdBy: actingAdmin,
    });
    return campaign.toObject();
};

exports.nextCronRun = (cron) => {
    // cron-parser v5 exposes CronExpressionParser.parse; v4 parseExpression.
    const parser = require('cron-parser');
    const parse = parser.CronExpressionParser
        ? (expr) => parser.CronExpressionParser.parse(expr)
        : (expr) => (parser.parseExpression || parser.parse)(expr);
    try {
        return new Date(parse(cron).next().toString());
    } catch {
        return null;
    }
};

exports.AUDIENCE_PRESETS = Object.keys(AUDIENCE_PRESETS);
