const logger = require('./logger');

exports.handleResponse = ({ res, statusCode = 200, message = 'Success', data = {} }) => {
    res.status(statusCode).json({ success: true, message, data });
};

/**
 * Central error responder. Accepts anything thrown anywhere in the stack:
 * curated errorCodes objects, Error instances, Mongoose/Mongo errors, arrays
 * from validators, plain strings — and normalizes to
 *   { success: false, message, code? } with a correct HTTP status.
 */
exports.handleError = ({ res, statusCode, error, err }) => {
    const rawError = error || err || 'error';
    let finalError = rawError;

    // Curated errorCodes entries are plain objects (never Error/axios/array
    // instances — those also carry `code`/`statusCode` fields that must not be
    // trusted as HTTP semantics).
    const isCuratedError = !!rawError
        && typeof rawError === 'object'
        && !(rawError instanceof Error)
        && !Array.isArray(rawError)
        && !rawError.isAxiosError;

    // Status precedence: explicit call-site > curated code's own > inferred > 500.
    if (statusCode === undefined && isCuratedError && typeof rawError.statusCode === 'number') {
        statusCode = rawError.statusCode;
    }

    if (finalError?.isAxiosError) {
        statusCode = statusCode ?? 502;
        finalError = finalError?.response?.statusText || finalError?.message || 'Upstream request failed';
    }
    if (finalError?.code === 11000) {
        statusCode = 409;
        const field = Object.keys(finalError.keyPattern || {})[0] || 'value';
        finalError = `This ${field} is already registered`;
    }
    if (finalError?.name === 'ValidationError') {
        statusCode = statusCode ?? 422;
        finalError = Object.values(finalError.errors || {}).map((e) => e.message).join(', ') || finalError.message;
    }
    if (Array.isArray(finalError)) {
        statusCode = statusCode ?? 422;
        finalError = finalError.map((e) => e?.msg?.en || e?.msg || e).join(', ');
    }
    if (finalError instanceof Error) {
        finalError = finalError.message;
    }
    if (finalError && typeof finalError === 'object') {
        finalError = finalError.en || finalError.msg || finalError.message;
    }
    if (typeof finalError !== 'string' || !finalError) {
        finalError = 'Something went wrong';
    }

    if (statusCode === undefined) statusCode = 500;
    const validStatusCode = Number.isInteger(statusCode) && statusCode >= 100 && statusCode < 600
        ? statusCode
        : 500;

    // Machine-readable code, only from curated entries (SCREAMING_SNAKE enforced —
    // Mongo/axios errors also carry `code` and must never be echoed).
    const errorCode = isCuratedError && typeof rawError.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(rawError.code)
        ? rawError.code
        : undefined;

    // Surfaced on the morgan log line for this request.
    res.error = finalError;

    // A 5xx backed by a raw Error is an uncaught internal failure — its message
    // can carry connection strings, paths, hosts. Log it fully, respond generically.
    if (validStatusCode >= 500) {
        logger.error('request failed (5xx)', {
            path: res.req?.originalUrl,
            method: res.req?.method,
            statusCode: validStatusCode,
            message: rawError instanceof Error ? rawError.message : finalError,
            ...(rawError instanceof Error && { stack: rawError.stack }),
        });
        if (rawError instanceof Error) {
            finalError = 'Internal server error';
        }
    }

    res.status(validStatusCode).json({
        success: false,
        message: finalError,
        ...(errorCode && { code: errorCode }),
    });
};
