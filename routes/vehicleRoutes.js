const express = require('express');
const router = express.Router();
const {
    getVehicles,
    createVehicle,
    updateVehicle,
    deleteVehicle,
} = require('../controllers/vehicleController');

router.route('/').get(getVehicles).post(createVehicle);
router.route('/:id').patch(updateVehicle).delete(deleteVehicle);

module.exports = router;
