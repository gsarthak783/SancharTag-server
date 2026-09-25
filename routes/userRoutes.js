const express = require('express');
const Validator = require('../validators/userValidator');
const postValidator = require('../middlewares/postValidator');
const { authenticateOwner } = require('../middlewares/auth');
const Controller = require('../controllers/userController');

const router = express.Router();

// Everything here is the authenticated owner acting on their own account.
router.use(authenticateOwner);

router.get('/me', Controller.me);
router.patch('/me', Validator.updateMe, postValidator, Controller.updateMe);
router.delete('/me', Controller.deleteMe);

router.get('/me/blocked', Controller.getBlocked);
router.post('/me/blocked', Validator.blockNumber, postValidator, Controller.block);
router.delete('/me/blocked/:phoneNumber', Validator.unblockNumber, postValidator, Controller.unblock);

module.exports = router;
