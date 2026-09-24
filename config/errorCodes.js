// Curated error catalog. Throw these from any layer; handleError resolves the
// message, statusCode and machine-readable code. Single language for now — the
// { en } shape leaves room for i18n later without changing call sites.
const codes = {
    // Auth / OTP
    PHONE_REQUIRED: { en: 'Please provide a valid phone number', statusCode: 422 },
    INVALID_OTP: { en: 'Invalid or expired OTP', statusCode: 400 },
    OTP_ATTEMPTS_EXCEEDED: { en: 'Too many incorrect attempts. Please request a new OTP', statusCode: 429 },
    OTP_RESEND_TOO_SOON: { en: 'Please wait before requesting another OTP', statusCode: 429 },
    UNAUTHORIZED: { en: 'Authentication required', statusCode: 401 },
    INVALID_TOKEN: { en: 'Invalid or expired session. Please log in again', statusCode: 401 },
    SESSION_EXPIRED: { en: 'Your session has expired. Please log in again', statusCode: 401 },
    INVALID_SCAN_TOKEN: { en: 'This scan link is invalid or has expired. Please scan the QR code again', statusCode: 401 },
    INVALID_SCANNER_TOKEN: { en: 'Phone verification expired. Please verify your number again', statusCode: 401 },
    SCAN_TOKEN_USED: { en: 'This scan session was already used. Please scan the QR code again', statusCode: 401 },
    INVALID_INTERACTION_TOKEN: { en: 'This chat session is invalid or has expired', statusCode: 401 },

    // Users
    USER_NOT_FOUND: { en: 'User not found', statusCode: 404 },
    ACCOUNT_SUSPENDED: { en: 'This account has been suspended', statusCode: 403 },
    NOT_OWNER: { en: 'You do not have access to this resource', statusCode: 403 },
    ALREADY_BLOCKED: { en: 'This number is already blocked', statusCode: 409 },

    // Vehicles
    VEHICLE_NOT_FOUND: { en: 'Vehicle not found', statusCode: 404 },
    TAG_NOT_FOUND: { en: 'No vehicle is registered for this tag', statusCode: 404 },
    VEHICLE_INACTIVE: { en: 'This tag is not active', statusCode: 404 },
    VEHICLE_LIMIT_REACHED: { en: 'Vehicle limit reached for this account', statusCode: 403 },

    // Interactions / messaging
    INTERACTION_NOT_FOUND: { en: 'Interaction not found', statusCode: 404 },
    SESSION_ENDED: { en: 'This session has ended. You cannot send more messages', statusCode: 409 },
    BLOCKED_BY_OWNER: { en: 'You have been blocked by this user', statusCode: 403 },
    INVALID_STATUS: { en: 'Invalid status value', statusCode: 422 },
    MESSAGE_TEXT_REQUIRED: { en: 'Message text is required', statusCode: 422 },
    MESSAGE_TOO_LONG: { en: 'Message is too long', statusCode: 422 },

    // Reports
    REPORT_NOT_FOUND: { en: 'Report not found', statusCode: 404 },
    ALREADY_REPORTED: { en: 'This interaction has already been reported', statusCode: 409 },

    // Admin (internal surface for the console)
    ADMIN_DISABLED: { en: 'Admin API is not enabled on this server', statusCode: 503 },
    ADMIN_UNAUTHORIZED: { en: 'Invalid admin credentials', statusCode: 401 },

    // Generic
    VALIDATION_FAILED: { en: 'Validation failed', statusCode: 422 },
    RATE_LIMITED: { en: 'Too many requests. Please try again later', statusCode: 429 },
    ROUTE_NOT_FOUND: { en: 'Route not found', statusCode: 404 },
    INTERNAL_ERROR: { en: 'Something went wrong. Please try again', statusCode: 500 },
};

// code === key, so responses carry a stable machine-readable identifier.
for (const [key, value] of Object.entries(codes)) {
    value.code = key;
}

module.exports = codes;
