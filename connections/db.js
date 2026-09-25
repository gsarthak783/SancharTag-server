const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('../utils/logger');

const connect = async () => {
    mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error', { error: err.message });
    });
    mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
    });
    const conn = await mongoose.connect(config.database);
    logger.info(`MongoDB connected: ${conn.connection.host}`);
    return conn;
};

const disconnect = () => mongoose.disconnect();

module.exports = { connect, disconnect };
