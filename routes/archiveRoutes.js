const express = require('express');
const router = express.Router();
const {
    archiveUser,
    archiveVehicle,
    archiveInteraction
} = require('../controllers/archiveController');

router.post('/deletedUsers', archiveUser);
router.post('/deletedVehicles', archiveVehicle);
router.post('/deletedInteractions', archiveInteraction);

module.exports = router;
