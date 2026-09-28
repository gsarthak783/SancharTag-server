const express = require('express');
const adminInternalAuth = require('../middlewares/adminInternalAuth');
const Controller = require('../controllers/adminController');

const router = express.Router();

// Server-to-server only: the SancharTag Console authenticates its admins
// (sessions + 2FA + audit) and calls here with the internal key.
router.use(adminInternalAuth);

router.get('/stats', Controller.stats);

router.get('/users', Controller.listUsers);
router.get('/users/:userId', Controller.getUser);
router.post('/users/:userId/suspend', Controller.suspendUser);
router.post('/users/:userId/unsuspend', Controller.unsuspendUser);
router.post('/users/:userId/force-logout', Controller.forceLogout);
router.delete('/users/:userId', Controller.deleteUser);

router.get('/vehicles', Controller.listVehicles);
router.post('/vehicles/:vehicleId/deactivate', Controller.setVehicleActive(false));
router.post('/vehicles/:vehicleId/reactivate', Controller.setVehicleActive(true));
router.post('/vehicles/:vehicleId/regenerate-tag', Controller.regenerateTag);

router.get('/reports', Controller.listReports);
router.get('/reports/:reportId', Controller.getReport);
router.patch('/reports/:reportId/status', Controller.setReportStatus);

router.get('/interactions/:interactionId', Controller.getInteractionMeta);
// Privacy unlock: console enforces superadmin + step-up + reason; we enforce
// the reason again and log the access loudly.
router.get('/interactions/:interactionId/messages', Controller.unlockInteractionMessages);

// Notification engine (feature 02, phase C)
router.get('/templates', Controller.listTemplates);
router.post('/templates', Controller.createTemplate);
router.patch('/templates/:key', Controller.updateTemplate);
router.get('/campaigns', Controller.listCampaigns);
router.post('/campaigns', Controller.createCampaign);
router.get('/campaigns/:campaignId', Controller.getCampaign);
router.post('/campaigns/:campaignId/pause', Controller.setCampaignState('pause'));
router.post('/campaigns/:campaignId/resume', Controller.setCampaignState('resume'));
router.post('/campaigns/:campaignId/cancel', Controller.setCampaignState('cancel'));
router.post('/audience-preview', Controller.previewAudience);
router.get('/users/:userId/deliveries', Controller.userDeliveries);

router.get('/support/otp-status', Controller.otpStatus);
router.post('/support/clear-rate-limit', Controller.clearRateLimit);

module.exports = router;
