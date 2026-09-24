const express = require('express');
const Validator = require('../validators/authValidator');
const postValidator = require('../middlewares/postValidator');
const { authOtpLimiter, otpResendCooldown } = require('../middlewares/rateLimiter/authOtp');
const { authenticateOwner } = require('../middlewares/auth');
const Controller = require('../controllers/authController');

const router = express.Router();

router.post('/send-otp', Validator.sendOtp, postValidator, ...authOtpLimiter, otpResendCooldown, Controller.sendOtp);
router.post('/verify-otp', Validator.verifyOtp, postValidator, ...authOtpLimiter, Controller.verifyOtp);
// Scanner phone verification — same OTP issue flow, but verification returns a
// scanner token (verified phone) instead of creating a user account.
router.post('/verify-scanner-otp', Validator.verifyOtp, postValidator, ...authOtpLimiter, Controller.verifyScannerOtp);
router.post('/logout', authenticateOwner, Controller.logout);

module.exports = router;
