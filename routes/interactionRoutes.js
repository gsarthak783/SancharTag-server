const express = require('express');
const router = express.Router();
const {
    getInteractions,
    createInteraction,
    updateInteraction,
    deleteInteraction,
    addMessage,
    getInteractionById,
    updateStatus,
    resolveInteraction
} = require('../controllers/interactionController');

router.route('/').get(getInteractions).post(createInteraction);
router.route('/:id').get(getInteractionById).patch(updateInteraction).delete(deleteInteraction);
router.route('/:id/messages').post(addMessage);
router.route('/:id/status').patch(updateStatus);
router.route('/:id/resolve').patch(resolveInteraction);

module.exports = router;
