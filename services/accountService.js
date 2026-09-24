const userService = require('../dbServices/userService');
const vehicleService = require('../dbServices/vehicleService');
const interactionService = require('../dbServices/interactionService');
const archiveService = require('../dbServices/archiveService');
const errorCodes = require('../config/errorCodes');

/**
 * The one account-deletion cascade: archive-then-delete the user, their
 * vehicles and their interactions. Used by self-service DELETE /users/me and
 * by the console's admin delete — a single implementation so the two paths
 * can never disagree.
 */
exports.deleteUserCascade = async (userId, deletedBy) => {
    const userDoc = await userService.remove(userId);
    if (!userDoc) throw errorCodes.USER_NOT_FOUND;

    await archiveService.archiveUser(userDoc, deletedBy);
    const vehicles = await vehicleService.removeAllByUser(userId);
    await archiveService.archiveVehicles(vehicles, deletedBy);
    const interactions = await interactionService.removeAllByUser(userId);
    await archiveService.archiveInteractions(interactions, deletedBy);

    return { userId, vehicles: vehicles.length, interactions: interactions.length };
};
