const vehicleService = require('../dbServices/vehicleService');
const userService = require('../dbServices/userService');
const interactionService = require('../dbServices/interactionService');
const consumedTokenService = require('../dbServices/consumedTokenService');
const notificationService = require('./notificationService');
const sockets = require('../sockets');
const errorCodes = require('../config/errorCodes');
const logger = require('../utils/logger');
const { generateScanToken, generateInteractionToken } = require('../utils/token');
const { CONTACT_TYPE } = require('../constants/interaction');

/**
 * Scanner-facing vehicle view. STRICT WHITELIST — this is the privacy boundary
 * the whole product stands on. Never expose ownerName, owner phone, userId,
 * vehicleId or Mongo _id here.
 */
const buildScanView = (vehicle, owner) => {
    const showEmergencyContact = owner.privacySettings?.showEmergencyContact ?? true;
    return {
        tagId: vehicle.tagId,
        vehicleName: vehicle.vehicleName,
        vehicleNumber: vehicle.vehicleNumber,
        vehicleType: vehicle.vehicleType,
        notes: vehicle.notes || null,
        showEmergencyContact,
        // Vehicle-level override wins; owner profile contact is the fallback.
        emergencyContact: showEmergencyContact
            ? (vehicle.emergencyContactNumber || owner.emergencyContact || null)
            : null,
    };
};

const scanViewForVehicle = async (vehicle) => {
    if (!vehicle) throw errorCodes.TAG_NOT_FOUND;
    if (!vehicle.isActive) throw errorCodes.VEHICLE_INACTIVE;
    const owner = await userService.getByUserId(vehicle.userId);
    if (!owner || owner.status === 'suspended') throw errorCodes.TAG_NOT_FOUND;

    return {
        // Interactions are tagId-addressed; a /t/{code} arrival has no tagId
        // in its URL, so every scan view names it explicitly.
        tagId: vehicle.tagId,
        vehicle: buildScanView(vehicle, owner),
        scanToken: generateScanToken(vehicle.tagId),
    };
};

exports.getScanView = async (tagId) =>
    scanViewForVehicle(await vehicleService.getByTagId(tagId));

// Sticker short-code URLs (QR print kit, feature 07): scan.…/t/{code}.
exports.getScanViewByCode = async (shortCode) =>
    scanViewForVehicle(await vehicleService.getByShortCode(shortCode));

const notifyOwnerOfScan = async (owner, vehicle, interactionId) => {
    const prefs = await userService.getByUserId(owner.userId);
    if (!prefs?.notificationPreferences?.newScans) return;
    // Transactional: a scan alert IS the product. Push to every device on
    // the MAX-importance 'scans' channel + inbox entry; interactionId as
    // dedupeKey collapses any double-fire to one send.
    await notificationService.notifyUser({
        userId: owner.userId,
        eventKey: 'new_scan',
        dedupeKey: `scan:${interactionId}`,
        title: 'Vehicle scanned',
        body: `Someone scanned the tag on ${vehicle.vehicleNumber}`,
        data: { interactionId, type: 'new_interaction' },
        deepLink: `/interaction/${interactionId}`,
        channels: ['push', 'inapp'],
        channelId: 'scans',
    });
};

/**
 * Scan token + scanner token → interaction. Order matters:
 *  1. consume the single-use scan jti (double-spend = 401, nothing written)
 *  2. block check BEFORE create (blocked scanners leave no rows behind)
 *  3. create with server-generated id and minimal capture context
 * scannerPhone comes from the OTP-verified scanner token (middleware), which
 * is what makes owner-side blocking genuinely enforceable.
 */
exports.createInteraction = async ({ tagId, scanTokenInfo, scannerPhone, body, ip, userAgent }) => {
    const firstUse = await consumedTokenService.consume(scanTokenInfo.jti, scanTokenInfo.exp);
    if (!firstUse) throw errorCodes.SCAN_TOKEN_USED;

    const vehicle = await vehicleService.getByTagId(tagId);
    if (!vehicle || !vehicle.isActive) throw errorCodes.TAG_NOT_FOUND;
    const owner = await userService.getByUserId(vehicle.userId);
    if (!owner || owner.status === 'suspended') throw errorCodes.TAG_NOT_FOUND;

    if (await userService.isBlocked(vehicle.userId, scannerPhone)) {
        throw errorCodes.BLOCKED_BY_OWNER;
    }
    // Platform-level restriction (feature 09) — defense in depth behind the
    // scanner-OTP gate: tokens issued before a restriction landed die here.
    const trustService = require('./trustService');
    if (await trustService.isBlockedFromPlatform(scannerPhone)) {
        throw errorCodes.SCANNER_RESTRICTED;
    }

    const interaction = await interactionService.create({
        userId: vehicle.userId,
        vehicleId: vehicle.vehicleId,
        type: body.type || 'Scan',
        contactType: CONTACT_TYPE.SCAN,
        scanner: {
            phoneNumber: scannerPhone,
            phoneVerified: true,
            name: body.name || undefined,
            ip,
            userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
            capturedAt: new Date(),
        },
        ...(body.location && { location: body.location }),
    });

    sockets.emitToUser(vehicle.userId, 'new_interaction', interaction);
    notifyOwnerOfScan(owner, vehicle, interaction.interactionId).catch((err) => {
        logger.error('scan push failed', { error: err.message });
    });
    // Engagement counter for lifecycle segments ("0 scans in 14d" etc.).
    userService.touchLastScan(vehicle.userId).catch(() => { });
    // Velocity guard (feature 09): flood patterns become trust events —
    // passive signal now, watch-listing at repetition. Fire-and-forget.
    (async () => {
        const stats = await interactionService.scannerDayStats(scannerPhone, vehicle.vehicleId);
        if (stats.distinctVehicles >= 8 || stats.onThisVehicle >= 5) {
            await trustService.recordEvent({
                phoneNumber: scannerPhone,
                kind: 'interaction_flood',
                ownerUserId: vehicle.userId,
                interactionId: interaction.interactionId,
            });
        }
    })().catch(() => { });

    return {
        interaction: {
            interactionId: interaction.interactionId,
            status: interaction.status,
            contactType: interaction.contactType,
            createdAt: interaction.createdAt,
        },
        interactionToken: generateInteractionToken({
            interactionId: interaction.interactionId,
            phoneNumber: scannerPhone,
        }),
    };
};
