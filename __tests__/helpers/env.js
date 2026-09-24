// jest setupFiles: runs before any module import, so config/config.js sees a
// complete environment. The MONGODB_URI is a placeholder — tests connect
// mongoose to an in-memory server themselves.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://placeholder-not-used-in-tests';
process.env.JWT_SECRET = 'test-secret-key';
process.env.SMS_ENABLED = 'false';
process.env.MASTER_OTP = '999999';
process.env.ADMIN_INTERNAL_KEY = 'test-admin-internal-key';
process.env.LOG_LEVEL = 'error';
