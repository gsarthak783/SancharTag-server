const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { User, Vehicle, Interaction, DeletedUser, DeletedVehicle, DeletedInteraction } = require('./db');

// Connect to MongoDB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

const importData = async () => {
    await connectDB();

    try {
        // Read db.json
        const dbPath = path.join(__dirname, '../client/db.json');
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

        // Clear existing data
        console.log('Clearing existing data...');
        await User.deleteMany();
        await Vehicle.deleteMany();
        await Interaction.deleteMany();
        await DeletedUser.deleteMany();
        await DeletedVehicle.deleteMany();
        await DeletedInteraction.deleteMany();

        // Import Users
        if (data.users && data.users.length > 0) {
            console.log(`Importing ${data.users.length} users...`);
            // Ensure date fields are proper Dates
            const users = data.users.map(u => ({
                ...u,
                createdAt: u.createdAt ? new Date(u.createdAt) : undefined,
                policyAcceptedAt: u.policyAcceptedAt ? new Date(u.policyAcceptedAt) : undefined
            }));
            await User.insertMany(users);
        }

        // Import Vehicles
        if (data.vehicles && data.vehicles.length > 0) {
            console.log(`Importing ${data.vehicles.length} vehicles...`);
            const vehicles = data.vehicles.map(v => ({
                ...v,
                createdAt: v.createdAt ? new Date(v.createdAt) : undefined
            }));
            await Vehicle.insertMany(vehicles);
        }

        // Import Interactions
        if (data.interactions && data.interactions.length > 0) {
            console.log(`Importing ${data.interactions.length} interactions...`);
            const interactions = data.interactions.map(i => ({
                ...i,
                createdAt: i.createdAt ? new Date(i.createdAt) : undefined,
                updatedAt: i.updatedAt ? new Date(i.updatedAt) : undefined,
                messages: i.messages ? i.messages.map(m => ({
                    ...m,
                    timestamp: m.timestamp ? new Date(m.timestamp) : undefined
                })) : []
            }));
            await Interaction.insertMany(interactions);
        }

        // Import Deleted Data
        if (data.deletedUsers && data.deletedUsers.length > 0) {
            console.log(`Importing ${data.deletedUsers.length} deleted users...`);
            await DeletedUser.insertMany(data.deletedUsers);
        }
        if (data.deletedVehicles && data.deletedVehicles.length > 0) {
            console.log(`Importing ${data.deletedVehicles.length} deleted vehicles...`);
            await DeletedVehicle.insertMany(data.deletedVehicles);
        }
        if (data.deletedInteractions && data.deletedInteractions.length > 0) {
            console.log(`Importing ${data.deletedInteractions.length} deleted interactions...`);
            await DeletedInteraction.insertMany(data.deletedInteractions);
        }

        console.log('Data Imported Successfully!');
        process.exit();
    } catch (error) {
        console.error(`Error importing data: ${error}`);
        process.exit(1);
    }
};

importData();
