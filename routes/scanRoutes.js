const express = require('express');
const Validator = require('../validators/interactionValidator');
const postValidator = require('../middlewares/postValidator');
const { publicRateLimiter } = require('../middlewares/rateLimiter/publicApi');
const { authenticateScanToken } = require('../middlewares/auth');
const Controller = require('../controllers/scanController');

const router = express.Router();

// The anonymous, scanner-facing surface. Rate-limited; responses are strict
// whitelists (see scanService.buildScanView).
router.get('/:tagId', publicRateLimiter, Controller.getScanView);
router.post(
    '/:tagId/interactions',
    publicRateLimiter,
    Validator.createFromScan,
    postValidator,
    authenticateScanToken,
    Controller.createInteraction,
);

module.exports = router;
