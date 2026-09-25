const express = require('express');
const Validator = require('../validators/vehicleValidator');
const postValidator = require('../middlewares/postValidator');
const { authenticateOwner, requireOwnership } = require('../middlewares/auth');
const Controller = require('../controllers/vehicleController');

const router = express.Router();

router.use(authenticateOwner);

router.get('/', Controller.list);
router.post('/', Validator.create, postValidator, Controller.create);
router.patch('/:vehicleId', Validator.update, postValidator, requireOwnership('vehicle'), Controller.update);
router.delete('/:vehicleId', requireOwnership('vehicle'), Controller.remove);

module.exports = router;
