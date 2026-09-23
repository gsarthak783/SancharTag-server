const express = require('express');
const Validator = require('../validators/authValidator');
const postValidator = require('../middlewares/postValidator');
const { authOtpLimiter, otpResendCooldown } = require('../middlewares/rateLimiter/authOtp');
const { authenticateOwner } = require('../middlewares/auth');
const Controller = require('../controllers/authController');

const router = express.Router();

router.post('/send-otp', Validator.sendOtp, postValidator, ...authOtpLimiter, otpResendCooldown, Controller.sendOtp);
router.post('/verify-otp', Validator.verifyOtp, postValidator, ...authOtpLimiter, Controller.verifyOtp);
router.post('/logout', authenticateOwner, Controller.logout);

module.exports = router;
