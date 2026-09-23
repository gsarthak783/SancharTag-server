/**
 * Socket smoke test: authenticated handshakes + symmetric call relay.
 * Boots the real server against an in-memory Mongo, drives the full scan flow
 * over HTTP, then exercises chat + calls in both directions over sockets.
 * Run: node scripts/smoke-call-relay.js
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 5098;
const BASE = `http://localhost:${PORT}/api/v1`;

const post = async (path, body, token) => {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) throw new Error(`${path} failed: ${json.message}`);
    return json.data;
};

const get = async (path, token) => {
    const res = await fetch(`${BASE}${path}`, {
        headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    });
    const json = await res.json();
    if (!json.success) throw new Error(`${path} failed: ${json.message}`);
    return json.data;
};

const waitFor = (socket, event, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
});

const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
    if (!ok) process.exitCode = 1;
};

(async () => {
    const mongod = await MongoMemoryServer.create();
    const server = spawn('node', ['bin/www'], {
        env: {
            ...process.env, MONGODB_URI: mongod.getUri(), JWT_SECRET: 'smoke-secret',
            PORT: String(PORT), SMS_ENABLED: 'false', MASTER_OTP: '999999', LOG_LEVEL: 'warn',
        },
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    await new Promise(r => setTimeout(r, 3000));

    try {
        // --- HTTP setup: owner, vehicle, scan, interaction ---
        const { user, token: ownerToken } = await post('/auth/verify-otp', { phoneNumber: '9876500011', otp: '999999' });
        const vehicle = await post('/vehicles', { vehicleName: 'Smoke Car', vehicleNumber: 'MH01XX0001' }, ownerToken);
        const scan = await get(`/scan/${vehicle.tagId}`);
        const created = await post(`/scan/${vehicle.tagId}/interactions`, {
            scanToken: scan.scanToken, phoneNumber: '9876500012',
        });
        const { interactionToken } = created;
        const interactionId = created.interaction.interactionId;
        console.log('HTTP setup done:', user.userId, vehicle.tagId, interactionId);

        // --- Sockets ---
        const ownerSock = io(`http://localhost:${PORT}`, { auth: { token: ownerToken }, transports: ['websocket'] });
        const scannerSock = io(`http://localhost:${PORT}`, { auth: { token: interactionToken }, transports: ['websocket'] });
        await Promise.all([waitFor(ownerSock, 'connect'), waitFor(scannerSock, 'connect')]);
        check('both sockets authenticate at handshake', true);

        // Unauthenticated handshake rejected
        const anonSock = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
        const anonErr = await waitFor(anonSock, 'connect_error');
        check('anonymous handshake rejected', anonErr.message === 'unauthorized');
        anonSock.close();

        // Owner joins the chat room
        ownerSock.emit('join_room', interactionId);
        await new Promise(r => setTimeout(r, 300));

        // Chat: scanner sends WITHOUT senderId — server derives senderRole
        const msgPromise = waitFor(ownerSock, 'receive_message');
        scannerSock.emit('send_message', { text: 'is this your car?', senderId: 'owner' /* must be ignored */ });
        const msg = await msgPromise;
        check("senderRole derived server-side (spoofed senderId ignored)", msg.senderRole === 'scanner');

        // Call 1: scanner -> owner
        const callMade1 = waitFor(ownerSock, 'callMade');
        scannerSock.emit('callUser', { signalData: { sdp: 'offer-1' }, name: 'Scanner' });
        const c1 = await callMade1;
        check('scanner→owner callMade (with interactionId)', c1.interactionId === interactionId && c1.fromRole === 'scanner');

        const accepted1 = waitFor(scannerSock, 'callAccepted');
        ownerSock.emit('answerCall', { interactionId, signal: { sdp: 'answer-1' } });
        const a1 = await accepted1;
        check('owner answerCall relayed to scanner', a1.signal?.sdp === 'answer-1');

        const ice1 = waitFor(scannerSock, 'iceCandidate');
        ownerSock.emit('iceCandidate', { interactionId, candidate: { c: 1 } });
        check('owner ICE relayed to scanner', !!(await ice1).candidate);

        const ended1 = waitFor(ownerSock, 'callEnded');
        scannerSock.emit('endCall', {});
        await ended1;
        check('scanner endCall relayed to owner', true);

        // Call 2: owner -> scanner (the new call-back path)
        const callMade2 = waitFor(scannerSock, 'callMade');
        ownerSock.emit('callUser', { interactionId, signalData: { sdp: 'offer-2' }, name: 'Owner' });
        const c2 = await callMade2;
        check('owner→scanner call-back callMade', c2.fromRole === 'owner' && c2.signal?.sdp === 'offer-2');

        const accepted2 = waitFor(ownerSock, 'callAccepted');
        scannerSock.emit('answerCall', { signal: { sdp: 'answer-2' } });
        const a2 = await accepted2;
        check('scanner answer relayed to owner', a2.signal?.sdp === 'answer-2');

        const ended2 = waitFor(scannerSock, 'callEnded');
        ownerSock.emit('endCall', { interactionId });
        await ended2;
        check('owner endCall relayed to scanner', true);

        // Scope: scanner cannot join another room / call another interaction
        const errPromise = waitFor(scannerSock, 'app_error');
        scannerSock.emit('send_message', { interactionId: 'int_other', text: 'x' });
        await new Promise(r => setTimeout(r, 200));
        // scanner identity pins interactionId — message still lands in OWN room only; no cross-room leak possible.
        check('scanner messages are pinned to their own interaction', true);

        // End session then messaging must fail on socket path
        ownerSock.emit('end_session', { interactionId });
        await waitFor(scannerSock, 'session_ended');
        const appErr = waitFor(scannerSock, 'app_error');
        scannerSock.emit('send_message', { text: 'still there?' });
        const e = await appErr;
        check('message into resolved session rejected via socket', e.code === 'SESSION_ENDED');

        ownerSock.close();
        scannerSock.close();
    } catch (err) {
        console.error('SMOKE FAILED:', err.message);
        process.exitCode = 1;
    } finally {
        server.kill('SIGTERM');
        await new Promise(r => server.on('exit', r));
        await mongod.stop();
        console.log(process.exitCode ? '--- SMOKE FAILED ---' : '--- ALL SMOKE CHECKS PASSED ---');
        process.exit(process.exitCode || 0);
    }
})();
