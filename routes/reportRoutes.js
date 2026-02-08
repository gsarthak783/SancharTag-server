const express = require('express');
const router = express.Router();
const { createReport, getReports } = require('../controllers/reportController');

router.route('/').get(getReports).post(createReport);

module.exports = router;
