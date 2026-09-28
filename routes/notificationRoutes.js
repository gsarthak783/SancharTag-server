const express = require('express');
const { authenticateOwner } = require('../middlewares/auth');
const Controller = require('../controllers/notificationController');

const router = express.Router();

// The in-app inbox (the bell). Owner-only.
router.use(authenticateOwner);
router.get('/', Controller.list);
router.patch('/read', Controller.markRead);

module.exports = router;
