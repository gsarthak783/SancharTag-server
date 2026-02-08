const mongoose = require('mongoose');

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

// User Schema
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    phoneNumber: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    status: { type: String, default: 'active' },
    notificationPreferences: {
        pushEnabled: { type: Boolean, default: true },
        emailEnabled: { type: Boolean, default: true },
        smsEnabled: { type: Boolean, default: false }
    },
    acceptedPolicy: { type: Boolean, default: false },
    policyAcceptedAt: { type: Date },
    emergencyContact: { type: String }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Vehicle Schema
const vehicleSchema = new mongoose.Schema({
    vehicleId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, ref: 'User' }, // Reference to User's userId (or _id if we strictly used ObjectId)
    // Note: Since 'userId' in db.json seems to be a custom ID string, we might populate based on that field
    // or switching to standard _id refs. For now keeping it as String to match current data structure.

    vehicleName: { type: String, required: true },
    vehicleNumber: { type: String, required: true },
    vehicleType: { type: String, required: true },
    notes: { type: String },
    tagId: { type: String },
    ownerName: { type: String },
    ownerContactNumber: { type: String },
    emergencyContactNumber: { type: String },
    isActive: { type: Boolean, default: true },
    qrCodeUrl: { type: String }
}, {
    timestamps: true
});

// Interaction Schema
const messageSchema = new mongoose.Schema({
    messageId: { type: String },
    senderId: { type: String },
    text: { type: String },
    timestamp: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false }
}, { _id: false });

const interactionSchema = new mongoose.Schema({
    interactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true }, // Reference to user
    vehicleId: { type: String, required: true }, // Reference to vehicle
    type: { type: String, required: true }, // e.g., Wrong Parking
    contactType: { type: String, required: true }, // e.g., chat, scan
    status: { type: String, default: 'active' }, // active, resolved, missed, ignored

    // Scanner details captured during interaction
    scanner: {
        phoneNumber: { type: String },
        ip: { type: String },
        city: { type: String },
        region: { type: String },
        country: { type: String },
        userAgent: { type: String },
        platform: { type: String },
        language: { type: String },
        screenResolution: { type: String },
        timezone: { type: String },
        capturedAt: { type: Date }
    },

    messages: [messageSchema],
    lastMessage: { type: String }
}, {
    timestamps: true
});

const User = mongoose.model('User', userSchema);
const Vehicle = mongoose.model('Vehicle', vehicleSchema);
const Interaction = mongoose.model('Interaction', interactionSchema);

// Archive Schemas (structure similar to originals but flexible or identical + deletedAt)
// Using Strict: false to easily accept the object moved from client
const deletedUserSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const deletedVehicleSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const deletedInteractionSchema = new mongoose.Schema({}, { strict: false, timestamps: true });

const DeletedUser = mongoose.model('DeletedUser', deletedUserSchema);
const DeletedVehicle = mongoose.model('DeletedVehicle', deletedVehicleSchema);
const DeletedInteraction = mongoose.model('DeletedInteraction', deletedInteractionSchema);

module.exports = {
    connectDB,
    User,
    Vehicle,
    Interaction,
    DeletedUser,
    DeletedVehicle,
    DeletedInteraction
};
