const express = require('express');
const router = express.Router();
const {
    getInteractions,
    createInteraction,
    updateInteraction,
    deleteInteraction
} = require('../controllers/interactionController');

router.route('/').get(getInteractions).post(createInteraction);
router.route('/:id').patch(updateInteraction).delete(deleteInteraction);

module.exports = router;
