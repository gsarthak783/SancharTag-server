const { verifyToken, refreshIfDue } = require('../utils/token');
const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const interactionService = require('../dbServices/interactionService');
const errorCodes = require('../config/errorCodes');
const { handleError } = require('../utils/requestHandlers');
const { TOKEN_PURPOSE, REFRESHED_TOKEN_HEADER } = require('../constants/tokens');

const extractBearer = (req) => {
    const header = req.headers.authorization;
    if (!header) throw errorCodes.UNAUTHORIZED;
    const [, token] = header.split(' ');
    if (!token) throw errorCodes.UNAUTHORIZED;
    return token;
};

const decode = (token) => {
    try {
        return verifyToken(token);
    } catch (err) {
        throw errorCodes.INVALID_TOKEN;
    }
};

// Owner session: verify → load user (with salt) → status + salt checks →
// req.user (salt stripped) → sliding refresh via response header.
const loadOwner = async (info, req, res) => {
    if (info.purpose) throw errorCodes.INVALID_TOKEN; // scoped tokens are not sessions
    const user = await userService.getAuthUser(info.userId);
    if (!user) throw errorCodes.INVALID_TOKEN;
    if (user.status === 'suspended') throw errorCodes.ACCOUNT_SUSPENDED;
    if (user.jwtSalt !== info.jwtSalt) throw errorCodes.SESSION_EXPIRED;

    const { jwtSalt, ...safeUser } = user;
    req.user = safeUser;
    req.tokenInfo = info;

    const refreshed = refreshIfDue({ info, user });
    if (refreshed) res.setHeader(REFRESHED_TOKEN_HEADER, refreshed);
};

const loadScanner = (info, req) => {
    if (info.purpose !== TOKEN_PURPOSE.INTERACTION) throw errorCodes.INVALID_INTERACTION_TOKEN;
    req.scanner = {
        interactionId: info.interactionId,
        phoneNumber: info.phoneNumber || null,
    };
    req.tokenInfo = info;
};

exports.authenticateOwner = async (req, res, next) => {
    try {
        await loadOwner(decode(extractBearer(req)), req, res);
        next();
    } catch (error) {
        handleError({ res, error });
    }
};

exports.authenticateScanner = async (req, res, next) => {
    try {
        loadScanner(decode(extractBearer(req)), req);
        next();
    } catch (error) {
        handleError({ res, error });
    }
};

// Endpoints both sides use (interaction detail, messages, reports): identity
// branches on the token's purpose claim — never on anything client-supplied.
exports.authenticateAny = async (req, res, next) => {
    try {
        const info = decode(extractBearer(req));
        if (info.purpose === TOKEN_PURPOSE.INTERACTION) {
            loadScanner(info, req);
        } else {
            await loadOwner(info, req, res);
        }
        next();
    } catch (error) {
        handleError({ res, error });
    }
};

// Scan tokens ride in the body of the interaction-create call.
exports.authenticateScanToken = async (req, res, next) => {
    try {
        const token = req.body?.scanToken;
        if (!token) throw errorCodes.INVALID_SCAN_TOKEN;
        let info;
        try {
            info = verifyToken(token);
        } catch (err) {
            throw errorCodes.INVALID_SCAN_TOKEN;
        }
        if (info.purpose !== TOKEN_PURPOSE.SCAN || !info.jti) throw errorCodes.INVALID_SCAN_TOKEN;
        if (info.tagId !== req.params.tagId) throw errorCodes.INVALID_SCAN_TOKEN;
        req.scanTokenInfo = info; // jti consumed at create time (single-use)
        next();
    } catch (error) {
        handleError({ res, error });
    }
};

// Scanner accountability: interaction creation also requires a scanner token
// (OTP-verified phone). The phone used for storage and block checks comes from
// THIS token — a body phoneNumber is never trusted.
exports.authenticateScannerToken = async (req, res, next) => {
    try {
        const token = req.body?.scannerToken;
        if (!token) throw errorCodes.INVALID_SCANNER_TOKEN;
        let info;
        try {
            info = verifyToken(token);
        } catch (err) {
            throw errorCodes.INVALID_SCANNER_TOKEN;
        }
        if (info.purpose !== TOKEN_PURPOSE.SCANNER || !info.phoneNumber) {
            throw errorCodes.INVALID_SCANNER_TOKEN;
        }
        req.scannerPhone = info.phoneNumber; // E.164, verified via OTP
        next();
    } catch (error) {
        handleError({ res, error });
    }
};

const OWNERSHIP_CONFIG = {
    vehicle: {
        param: 'vehicleId',
        load: (id) => vehicleService.getByVehicleId(id),
        notFound: errorCodes.VEHICLE_NOT_FOUND,
    },
    interaction: {
        param: 'interactionId',
        load: (id) => interactionService.getByInteractionId(id),
        notFound: errorCodes.INTERACTION_NOT_FOUND,
    },
};

/**
 * Loads the resource, verifies req.user owns it, attaches it as req.resource
 * so controllers don't re-fetch. Requires authenticateOwner earlier in the chain.
 */
exports.requireOwnership = (resourceType) => {
    const cfg = OWNERSHIP_CONFIG[resourceType];
    if (!cfg) throw new Error(`Unknown ownership resource: ${resourceType}`);
    return async (req, res, next) => {
        try {
            const resource = await cfg.load(req.params[cfg.param]);
            if (!resource) throw cfg.notFound;
            if (resource.userId !== req.user.userId) throw errorCodes.NOT_OWNER;
            req.resource = resource;
            next();
        } catch (error) {
            handleError({ res, error });
        }
    };
};
