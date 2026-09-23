const express = require('express');
const Validator = require('../validators/interactionValidator');
const postValidator = require('../middlewares/postValidator');
const { authenticateOwner, authenticateAny, requireOwnership } = require('../middlewares/auth');
const { messageRateLimiter } = require('../middlewares/rateLimiter/messages');
const Controller = require('../controllers/interactionController');

const router = express.Router();

// Owner-only: history list + lifecycle.
router.get('/', authenticateOwner, Controller.list);
router.patch('/:interactionId/status', authenticateOwner, Validator.updateStatus, postValidator, requireOwnership('interaction'), Controller.updateStatus);
router.patch('/:interactionId/resolve', authenticateOwner, requireOwnership('interaction'), Controller.resolve);
router.patch('/:interactionId/read', authenticateOwner, requireOwnership('interaction'), Controller.markRead);
router.delete('/:interactionId', authenticateOwner, requireOwnership('interaction'), Controller.remove);

// Shared: owner (must own it) or scanner (must hold this interaction's token).
router.get('/:interactionId', authenticateAny, Controller.getOne);
router.post('/:interactionId/messages', authenticateAny, Validator.sendMessage, postValidator, messageRateLimiter, Controller.sendMessage);

module.exports = router;
