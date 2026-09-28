const express = require('express');
const Validator = require('../validators/interactionValidator');
const postValidator = require('../middlewares/postValidator');
const { publicRateLimiter } = require('../middlewares/rateLimiter/publicApi');
const { authenticateScanToken, authenticateScannerToken } = require('../middlewares/auth');
const Controller = require('../controllers/scanController');

const router = express.Router();

// The anonymous, scanner-facing surface. Rate-limited; responses are strict
// whitelists (see scanService.buildScanView).
// Sticker short codes (declared BEFORE /:tagId so it isn't swallowed).
router.get('/code/:shortCode', publicRateLimiter, Controller.getScanViewByCode);
router.get('/:tagId', publicRateLimiter, Controller.getScanView);
router.post(
    '/:tagId/interactions',
    publicRateLimiter,
    Validator.createFromScan,
    postValidator,
    authenticateScanToken,
    authenticateScannerToken, // OTP-verified phone — scanner accountability
    Controller.createInteraction,
);

module.exports = router;
