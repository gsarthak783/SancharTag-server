const vehicleService = require('../dbServices/vehicleService');
const interactionService = require('../dbServices/interactionService');
const archiveService = require('../dbServices/archiveService');
const errorCodes = require('../config/errorCodes');
const { handleResponse, handleError } = require('../utils/requestHandlers');
const { pick } = require('../utils/pick');
const { MAX_VEHICLES_PER_USER } = require('../constants/vehicles');

const VEHICLE_WRITABLE_FIELDS = [
    'vehicleName', 'vehicleNumber', 'vehicleType', 'notes',
    'emergencyContactNumber', 'isActive',
];

exports.list = async (req, res) => {
    try {
        const data = await vehicleService.listByUser(req.user.userId);
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.create = async (req, res) => {
    try {
        const count = await vehicleService.countByUser(req.user.userId);
        if (count >= MAX_VEHICLES_PER_USER) throw errorCodes.VEHICLE_LIMIT_REACHED;

        const data = await vehicleService.create(
            req.user.userId,
            pick(req.body, VEHICLE_WRITABLE_FIELDS),
        );
        handleResponse({ res, statusCode: 201, message: 'Vehicle created', data });
    } catch (error) {
        handleError({ res, error });
    }
};

// requireOwnership('vehicle') ran before us: req.resource is the vehicle.
exports.update = async (req, res) => {
    try {
        const data = await vehicleService.update(
            req.resource.vehicleId,
            pick(req.body, VEHICLE_WRITABLE_FIELDS),
        );
        handleResponse({ res, data });
    } catch (error) {
        handleError({ res, error });
    }
};

exports.remove = async (req, res) => {
    try {
        const { vehicleId } = req.resource;
        const vehicleDoc = await vehicleService.remove(vehicleId);
        if (vehicleDoc) await archiveService.archiveVehicles([vehicleDoc], req.user.userId);
        const interactions = await interactionService.removeAllByVehicle(vehicleId);
        await archiveService.archiveInteractions(interactions, req.user.userId);
        handleResponse({ res, message: 'Vehicle deleted', data: { vehicleId } });
    } catch (error) {
        handleError({ res, error });
    }
};
