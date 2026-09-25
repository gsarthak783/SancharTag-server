const express = require('express');
const Validator = require('../validators/reportValidator');
const postValidator = require('../middlewares/postValidator');
const { authenticateOwner, authenticateAny } = require('../middlewares/auth');
const Controller = require('../controllers/reportController');

const router = express.Router();

router.post('/', authenticateAny, Validator.create, postValidator, Controller.create);
router.get('/', authenticateOwner, Controller.list);

module.exports = router;
