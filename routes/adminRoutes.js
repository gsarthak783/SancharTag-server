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

router.get('/support/otp-status', Controller.otpStatus);
router.post('/support/clear-rate-limit', Controller.clearRateLimit);

module.exports = router;
