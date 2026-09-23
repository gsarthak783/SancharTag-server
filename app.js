const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config/config');
const logger = require('./utils/logger');
const errorCodes = require('./config/errorCodes');
const { handleError } = require('./utils/requestHandlers');

// Zero-import logging everywhere (services, sockets, tasks).
global.logger = logger;

const app = express();

// Behind Render's proxy: correct req.ip for rate limiting, secure protocol detection.
app.set('trust proxy', 1);
// No ETags on API responses: a 304 would let a browser replay a stale
// x-refreshed-token header from cache and break the sliding session refresh.
app.set('etag', false);

// Health probe: before logging so it doesn't spam, no DB round-trip.
app.get('/api/v1/health', (req, res) => res.status(200).json({ ok: 1, uptime: process.uptime() }));

app.use(compression());

morgan.token('who', (req) => {
    if (req.user?.userId) return `owner:${req.user.userId}`;
    if (req.scanner?.interactionId) return `scanner:${req.scanner.interactionId}`;
    return '-';
});
morgan.token('error', (req, res) => (res.error ? `error:${JSON.stringify(res.error)}` : ''));
// No Authorization header, no request bodies — tokens, OTPs and chat text must
// never land in log files.
app.use(morgan(':remote-addr :method :url :status :res[content-length] :response-time ms :who :error', {
    stream: logger.stream,
}));

app.use(express.json({ limit: '1mb' }));

app.use(helmet());
app.use(cors({
    // Mobile apps and server-to-server calls send no Origin — allowed. Browsers
    // (the scanner web app) must match the allowlist.
    origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)),
    exposedHeaders: ['x-refreshed-token', 'Retry-After'],
}));

app.use('/api/v1', require('./routes'));

// 404 — anything not matched above.
app.use((req, res) => handleError({ res, error: errorCodes.ROUTE_NOT_FOUND }));

// Global error handler — body-parser failures, throws that escape controllers.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => handleError({ res, error: err }));

module.exports = app;
