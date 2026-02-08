const asyncHandler = require('express-async-handler');
const { User, Vehicle } = require('../db');

// @desc    Get users (supports query by phoneNumber and _embed=vehicles)
// @route   GET /users
// @access  Public
const getUsers = asyncHandler(async (req, res) => {
    const { phoneNumber, userId, _embed } = req.query;
    let query = {};

    if (phoneNumber) {
        query.phoneNumber = phoneNumber;
    }

    if (userId) {
        query.userId = userId;
    }

    let users = await User.find(query);

    // Handle _embed=vehicles simulation
    if (_embed === 'vehicles') {
        // Convert mongoose docs to objects to attach vehicles
        users = await Promise.all(users.map(async (user) => {
            const vehicles = await Vehicle.find({ userId: user.userId });
            return { ...user.toObject(), vehicles };
        }));
    }

    res.json(users);
});

// @desc    Create a user
// @route   POST /users
// @access  Public
const createUser = asyncHandler(async (req, res) => {
    const { userId, phoneNumber, name, email, notificationPreferences, acceptedPolicy, policyAcceptedAt, emergencyContact } = req.body;

    if (!userId || !phoneNumber) {
        res.status(400);
        throw new Error('Please add all required fields');
    }

    // Check if user exists
    const userExists = await User.findOne({ userId });

    if (userExists) {
        res.status(400);
        throw new Error('User already exists');
    }

    // Create user
    const user = await User.create({
        userId,
        phoneNumber,
        name,
        email,
        notificationPreferences,
        acceptedPolicy,
        policyAcceptedAt,
        emergencyContact
    });

    if (user) {
        res.status(201).json(user);
    } else {
        res.status(400);
        throw new Error('Invalid user data');
    }
});

// @desc    Update user
// @route   PATCH /users/:id
// @access  Public
const updateUser = asyncHandler(async (req, res) => {
    // Note: The client sends the custom 'userId' (e.g., user_123) in the URL usually if using json-server convention, 
    // but typically REST uses database _id. 
    // api.ts uses `${API_URL}/users/${userId}`, where userId is the custom string.
    // So we should search by custom `userId` field, NOT `_id`.

    const userId = req.params.id; // This corresponds to the user.userId field in our schema

    const user = await User.findOne({ userId: userId });

    if (!user) {
        // Try finding by _id if not found by custom userId, just in case
        // const userById = await User.findById(req.params.id);
        // if (!userById) { ... }
        res.status(404);
        throw new Error('User not found');
    }

    const updatedUser = await User.findOneAndUpdate({ userId: userId }, req.body, {
        new: true,
    });

    res.json(updatedUser);
});

// @desc    Delete user
// @route   DELETE /users/:id
// @access  Public
const deleteUser = asyncHandler(async (req, res) => {
    const userId = req.params.id;
    const user = await User.findOne({ userId });

    if (!user) {
        res.status(404);
        throw new Error('User not found');
    }

    await user.deleteOne();

    res.json({ id: userId });
});

module.exports = {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
};
