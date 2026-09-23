const { makeLimiter, limiterMiddleware } = require('./common');

// Message flood control: 30 messages/min per interaction (both parties share
// the room; a flood from either side trips it).
const limiter = makeLimiter({ keyPrefix: 'rl_messages', points: 30, duration: 60, blockDuration: 30 });

exports.messageRateLimiter = limiterMiddleware(
    limiter,
    (req) => req.params.interactionId || req.scanner?.interactionId || req.ip,
);

// Raw consume for the socket path (no req/res there).
exports.consumeMessageBudget = async (interactionId) => {
    try {
        await limiter.consume(interactionId);
        return true;
    } catch (rejection) {
        if (rejection instanceof Error) return true; // store failure: fail open
        return false;
    }
};
