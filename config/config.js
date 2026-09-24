require('dotenv').config();

const required = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}. See .env.example`);
    }
    return value;
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const smsEnabled = process.env.SMS_ENABLED === 'true';

module.exports = {
    NODE_ENV,
    isProduction,
    port: Number(process.env.PORT) || 5000,
    database: required('MONGODB_URI'),

    security: {
        secret: required('JWT_SECRET'),
        // Idle life: token dies if unused this long (renewed on activity via sliding refresh).
        tokenIdleDays: Number(process.env.TOKEN_IDLE_DAYS) || 30,
        // Absolute cap: no session survives past this, regardless of activity.
        absoluteSessionDays: Number(process.env.ABSOLUTE_SESSION_DAYS) || 180,
        scanTokenTtlMinutes: Number(process.env.SCAN_TOKEN_TTL_MINUTES) || 15,
        // A verified scanner stays verified this long — no re-OTP on rescans.
        scannerTokenTtlDays: Number(process.env.SCANNER_TOKEN_TTL_DAYS) || 7,
        interactionTokenTtlHours: Number(process.env.INTERACTION_TOKEN_TTL_HOURS) || 24,
    },

    otp: {
        expiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES) || 5,
        maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
        resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 30,
        // Fixed OTP for app-store review accounts. Unset = disabled.
        masterOtp: process.env.MASTER_OTP || null,
        smsEnabled,
        // OTP rides back in the API response only while SMS is off and we're not in production.
        exposeOtpInResponse: !isProduction && !smsEnabled,
    },

    // Default phone region for numbers sent without a country code.
    defaultPhoneRegion: process.env.DEFAULT_PHONE_REGION || 'IN',

    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),

    logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
};
