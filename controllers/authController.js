const asyncHandler = require('express-async-handler');
const { User, Otp } = require('../db');
const jwt = require('jsonwebtoken');

// Generate JWT
const generateToken = (id, phoneNumber) => {
    return jwt.sign({ id, phoneNumber }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

// @desc    Send OTP to phone number
// @route   POST /auth/send-otp
// @access  Public
const sendOtp = asyncHandler(async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        res.status(400);
        throw new Error('Please provide a phone number');
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in DB
    await Otp.create({
        phoneNumber,
        otp
    });

    // In production, we would send SMS here.
    // For now, return OTP in response for testing.
    console.log(`OTP for ${phoneNumber}: ${otp}`);

    res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        otp: otp // TEMPORARY: Return OTP for testing
    });
});

// @desc    Verify OTP
// @route   POST /auth/verify-otp
// @access  Public
const verifyOtp = asyncHandler(async (req, res) => {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
        res.status(400);
        throw new Error('Please provide phone number and OTP');
    }

    // Find the latest OTP for this number
    const validOtp = await Otp.findOne({ phoneNumber, otp }).sort({ createdAt: -1 });

    if (!validOtp) {
        res.status(400);
        throw new Error('Invalid or expired OTP');
    }

    // OTP is valid. Now check if user exists.
    let user = await User.findOne({ phoneNumber });
    let isNewUser = false;

    if (!user) {
        // Create user if not exists
        // Generate a simple userId
        const userId = `user_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

        user = await User.create({
            userId,
            phoneNumber
        });
        isNewUser = true;
    }

    // Clean up used OTPs
    await validOtp.deleteOne();

    res.status(200).json({
        success: true,
        isNewUser,
        user,
        token: generateToken(user._id, phoneNumber)
    });
});

module.exports = {
    sendOtp,
    verifyOtp
};
