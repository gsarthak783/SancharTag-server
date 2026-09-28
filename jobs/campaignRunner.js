const CampaignModel = require('../models/campaignModel');
const campaignService = require('../services/campaignService');
const logger = require('../utils/logger');

/**
 * Runs due campaigns (feature 02, phase C). The scheduled→running claim is
 * an atomic findOneAndUpdate — two instances can't double-run a campaign;
 * per-occurrence dedupe keys make even a crashed re-run idempotent.
 */
const runDueCampaigns = async (now = new Date()) => {
    // Claim one at a time until none are due.
    for (; ;) {
        const campaign = await CampaignModel.findOneAndUpdate(
            { state: 'scheduled', nextRunAt: { $lte: now } },
            { $set: { state: 'running' } },
            { new: true, lean: true },
        );
        if (!campaign) return;

        const occurrenceAt = campaign.nextRunAt || now;
        try {
            await campaignService.runCampaign(campaign, occurrenceAt);
            const isRecurring = campaign.schedule?.kind === 'recurring' && campaign.schedule.cron;
            await CampaignModel.updateOne(
                { campaignId: campaign.campaignId, state: 'running' }, // paused mid-run wins
                isRecurring
                    ? { $set: { state: 'scheduled', nextRunAt: campaignService.nextCronRun(campaign.schedule.cron) } }
                    : { $set: { state: 'done', nextRunAt: null } },
            );
        } catch (error) {
            logger.error('campaign run failed', { campaignId: campaign.campaignId, error: error.message });
            await CampaignModel.updateOne(
                { campaignId: campaign.campaignId },
                { $set: { state: 'paused', lastError: error.message } },
            );
        }
    }
};

module.exports = { runDueCampaigns };
