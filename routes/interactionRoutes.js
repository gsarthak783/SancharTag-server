const express = require('express');
const router = express.Router();
const {
    getInteractions,
    createInteraction,
    updateInteraction,
    deleteInteraction,
    addMessage
} = require('../controllers/interactionController');

router.route('/').get(getInteractions).post(createInteraction);
router.route('/:id').patch(updateInteraction).delete(deleteInteraction);
router.route('/:id/messages').post(addMessage);

module.exports = router;
