const express = require('express');
const router = express.Router();
const {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    blockUser,
    unblockUser,
    getBlockedUsers
} = require('../controllers/userController');

router.route('/').get(getUsers).post(createUser);
router.route('/:id').patch(updateUser).delete(deleteUser);
router.route('/:id/block').post(blockUser);
router.route('/:id/unblock').post(unblockUser);
router.route('/:id/blocked').get(getBlockedUsers);

module.exports = router;
