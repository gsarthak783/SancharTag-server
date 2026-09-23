const { makeLimiter, limiterMiddleware } = require('./common');

// Anonymous scanner-facing endpoints: 60 req/min per IP, 30s penalty.
const limiter = makeLimiter({ keyPrefix: 'rl_public', points: 60, duration: 60, blockDuration: 30 });

exports.publicRateLimiter = limiterMiddleware(limiter, (req) => req.ip);
