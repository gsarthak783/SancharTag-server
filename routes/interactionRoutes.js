const express = require('express');
const Validator = require('../validators/interactionValidator');
const postValidator = require('../middlewares/postValidator');
const { authenticateOwner, authenticateAny, requireOwnership } = require('../middlewares/auth');
const { messageRateLimiter } = require('../middlewares/rateLimiter/messages');
const Controller = require('../controllers/interactionController');
const multer = require('multer');
const errorCodes = require('../config/errorCodes');

const router = express.Router();

// Chat images ride multipart over HTTP (never the socket). Memory storage:
// sharp re-encodes immediately; nothing touches disk.
const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (/^image\//.test(file.mimetype)) return cb(null, true);
        return cb(Object.assign(new Error('not an image'), { code: 'NOT_IMAGE' }));
    },
}).single('image');
const handleImageUpload = (req, res, next) => imageUpload(req, res, (err) => {
    if (!err) return next();
    const mapped = err.code === 'LIMIT_FILE_SIZE' ? errorCodes.MEDIA_TOO_LARGE : errorCodes.MEDIA_INVALID;
    return res.status(mapped.statusCode).json({ success: false, message: mapped.en, code: Object.keys(errorCodes).find((k) => errorCodes[k] === mapped) });
});

// Owner-only: history list + lifecycle.
router.get('/', authenticateOwner, Controller.list);
router.patch('/:interactionId/status', authenticateOwner, Validator.updateStatus, postValidator, requireOwnership('interaction'), Controller.updateStatus);
router.patch('/:interactionId/resolve', authenticateOwner, requireOwnership('interaction'), Controller.resolve);
router.patch('/:interactionId/read', authenticateOwner, requireOwnership('interaction'), Controller.markRead);
router.delete('/:interactionId', authenticateOwner, requireOwnership('interaction'), Controller.remove);

// Shared: owner (must own it) or scanner (must hold this interaction's token).
router.get('/:interactionId', authenticateAny, Controller.getOne);
router.post('/:interactionId/messages', authenticateAny, Validator.sendMessage, postValidator, messageRateLimiter, Controller.sendMessage);
router.post('/:interactionId/media', authenticateAny, messageRateLimiter, handleImageUpload, Controller.uploadMedia);

module.exports = router;
