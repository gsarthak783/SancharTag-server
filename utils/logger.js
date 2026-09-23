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

const logger = winston.createLogger({
    level: config.logLevel,
    transports: [
        new winston.transports.File({
            level: 'info',
            filename: path.join(__dirname, '../logs/all-logs.log'),
            format: fileFormat,
            handleExceptions: true,
            maxsize: LOG_FILE_MAX_SIZE,
            maxFiles: LOG_FILE_MAX_COUNT,
            tailable: true,
        }),
        new winston.transports.Console({
            format: consoleFormat,
            handleExceptions: true,
        }),
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/exceptions.log'),
            format: fileFormat,
            maxsize: LOG_FILE_MAX_SIZE,
            maxFiles: LOG_FILE_MAX_COUNT,
            tailable: true,
        }),
    ],
    exitOnError: false,
});

// A second uncaughtException while the first is still being written would emit
// an unhandled 'write after end' on the exception transport's stream and crash
// the process despite exitOnError:false. Swallow those.
logger.exceptions.handlers.forEach((transport) => {
    if (transport._stream && typeof transport._stream.on === 'function') {
        transport._stream.on('error', (err) => {
            process.stderr.write(`[logger] exception transport stream error (suppressed): ${err.message}\n`);
        });
    }
});

// Stream interface for morgan.
logger.stream = {
    write(message) {
        logger.info(message.trim());
    },
};

module.exports = logger;
