const express = require('express');

const router = express.Router();

// Global pagination cap — no endpoint returns more than 100 items per page.
router.use((req, res, next) => {
    if (req.query.limit && +req.query.limit > 100) req.query.limit = '100';
    next();
});

// Domain routers are mounted here as phases land:
// router.use('/auth', require('./authRoutes'));
// router.use('/users', require('./userRoutes'));
// router.use('/vehicles', require('./vehicleRoutes'));
// router.use('/scan', require('./scanRoutes'));
// router.use('/interactions', require('./interactionRoutes'));
// router.use('/reports', require('./reportRoutes'));

module.exports = router;
