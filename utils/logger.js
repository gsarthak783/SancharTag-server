const path = require('path');
const { hostname } = require('os');
const winston = require('winston');
const config = require('../config/config');

const LOG_FILE_MAX_SIZE = 5 * 1024 * 1024; // 5MB per file
const LOG_FILE_MAX_COUNT = 5;              // 25MB total, oldest rotated out

const HOST_NAME = hostname();

const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format((info) => {
        info.host = HOST_NAME;
        info.pid = process.pid;
        return info;
    })(),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}: ${typeof message === 'object' ? JSON.stringify(message) : message}${rest}`;
    })
);

// Uncaught exceptions are handled at the process level in bin/www (which logs
// through this logger and decides whether to exit). Winston's own
// handleExceptions/exceptionHandlers are deliberately NOT used: its
// ExceptionStream ends after the first exception and a second one in quick
// succession crashes the process with an unhandled 'write after end'.
const logger = winston.createLogger({
    level: config.logLevel,
    transports: [
        new winston.transports.File({
            level: 'info',
            filename: path.join(__dirname, '../logs/all-logs.log'),
            format: fileFormat,
            maxsize: LOG_FILE_MAX_SIZE,
            maxFiles: LOG_FILE_MAX_COUNT,
            tailable: true,
        }),
        new winston.transports.Console({
            format: consoleFormat,
        }),
    ],
    exitOnError: false,
});

// Stream interface for morgan.
logger.stream = {
    write(message) {
        logger.info(message.trim());
    },
};

module.exports = logger;
