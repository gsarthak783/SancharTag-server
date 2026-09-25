/**
 * End-to-end scanner journey — drives the EXACT call sequence the
 * sanchartag-connect pages make, page by page:
 *   Landing → Contact (details + OTP steps) → Chat (REST + socket) →
 *   Report sheet → End session — plus the 7-day verification reuse and
 *   every negative path the UI handles.
 * Run: node scripts/smoke-scanner-journey.js
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 5097;
const BASE = `http://localhost:${PORT}/api/v1`;

let failures = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : ` ${extra}`}`);
    if (!ok) failures += 1;
};

const req = async (method, path, body, token) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        ...(body && { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
};

const waitFor = (socket, event, timeoutMs = 4000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
});

(async () => {
    const mongod = await MongoMemoryServer.create();
    const server = spawn('node', ['bin/www'], {
        env: {
            ...process.env, MONGODB_URI: mongod.getUri(), JWT_SECRET: 'journey-secret',
            PORT: String(PORT), SMS_ENABLED: 'false', MASTER_OTP: '999999', LOG_LEVEL: 'warn',
        },
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    await new Promise(r => setTimeout(r, 3000));
    let ownerSock; let scannerSock;

    try {
        // ---------- Owner exists with a tagged vehicle ----------
        const ownerLogin = await req('POST', '/auth/verify-otp', { phoneNumber: '9876511001', otp: '999999' });
        const ownerToken = ownerLogin.body.data.token;
        const ownerUserId = ownerLogin.body.data.user.userId;
        const vehicle = (await req('POST', '/vehicles', { vehicleName: 'Journey Car', vehicleNumber: 'DL01JR9999', notes: 'Please call if blocking' }, ownerToken)).body.data;

        // ---------- LANDING PAGE: GET /scan/:tagId ----------
        const scan1 = await req('GET', `/scan/${vehicle.tagId}`);
        check('Landing: scan view 200 with scanToken', scan1.status === 200 && !!scan1.body.data.scanToken);
        const scanBody = JSON.stringify(scan1.body);
        check('Landing: no owner identity in payload',
            !scanBody.includes(ownerUserId) && !scanBody.includes('9876511001') && !scanBody.includes('ownerName'));
        check('Landing: vehicle card fields present',
            scan1.body.data.vehicle.vehicleNumber === 'DL01JR9999' && scan1.body.data.vehicle.notes === 'Please call if blocking');
        check('Landing: unknown tag → TAG_NOT_FOUND',
            (await req('GET', '/scan/tag_nope')).body.code === 'TAG_NOT_FOUND');

        // ---------- CONTACT PAGE step 1→2: send OTP (real code, dev-exposed) ----------
        const SCANNER_PHONE_RAW = '9876511002';
        const sendOtp = await req('POST', '/auth/send-otp', { phoneNumber: SCANNER_PHONE_RAW });
        check('Contact: send-otp 200, dev OTP exposed', sendOtp.status === 200 && /^\d{6}$/.test(sendOtp.body.data.otp || ''));
        const realOtp = sendOtp.body.data.otp;

        check('Contact: wrong OTP rejected',
            (await req('POST', '/auth/verify-scanner-otp', { phoneNumber: SCANNER_PHONE_RAW, otp: '000000' })).body.code === 'INVALID_OTP');

        const verify = await req('POST', '/auth/verify-scanner-otp', { phoneNumber: SCANNER_PHONE_RAW, otp: realOtp });
        check('Contact: verify-scanner-otp → scannerToken (7-day)', verify.status === 200 && !!verify.body.data.scannerToken && verify.body.data.expiresInDays === 7);
        const scannerToken = verify.body.data.scannerToken;
        const replayVerify = await req('POST', '/auth/verify-scanner-otp', { phoneNumber: SCANNER_PHONE_RAW, otp: realOtp });
        check('Contact: OTP is single-use (replay rejected)',
            ['INVALID_OTP', 'RATE_LIMITED'].includes(replayVerify.body.code), `got ${replayVerify.body.code}`);

        // ---------- CONTACT PAGE: create interaction (both tokens) ----------
        check('Contact: create without scannerToken → 401',
            (await req('POST', `/scan/${vehicle.tagId}/interactions`, { scanToken: scan1.body.data.scanToken, type: 'Wrong Parking' })).status === 401);

        const create1 = await req('POST', `/scan/${vehicle.tagId}/interactions`,
            { scanToken: scan1.body.data.scanToken, scannerToken, type: 'Wrong Parking', name: 'Journey Tester' });
        check('Contact: create with both tokens → 201 + interactionToken', create1.status === 201 && !!create1.body.data.interactionToken);
        const interactionId = create1.body.data.interaction.interactionId;
        const interactionToken = create1.body.data.interactionToken;

        check('Contact: scan token single-use',
            (await req('POST', `/scan/${vehicle.tagId}/interactions`, { scanToken: scan1.body.data.scanToken, scannerToken })).body.code === 'SCAN_TOKEN_USED');

        // Owner sees the VERIFIED phone + name on the interaction.
        const ownerView = await req('GET', `/interactions/${interactionId}`, null, ownerToken);
        check('Owner sees verified scanner identity',
            ownerView.body.data.scanner.phoneNumber === '+919876511002'
            && ownerView.body.data.scanner.phoneVerified === true
            && ownerView.body.data.scanner.name === 'Journey Tester'
            && ownerView.body.data.type === 'Wrong Parking');

        // ---------- CHAT PAGE: history fetch + sockets both ways ----------
        const scannerView = await req('GET', `/interactions/${interactionId}`, null, interactionToken);
        check('Chat: scanner view trimmed (no owner ids / capture data)',
            scannerView.status === 200
            && !JSON.stringify(scannerView.body).includes(ownerUserId)
            && scannerView.body.data.scanner === undefined);

        ownerSock = io(`http://localhost:${PORT}`, { auth: { token: ownerToken }, transports: ['websocket'] });
        scannerSock = io(`http://localhost:${PORT}`, { auth: { token: interactionToken }, transports: ['websocket'] });
        await Promise.all([waitFor(ownerSock, 'connect'), waitFor(scannerSock, 'connect')]);
        ownerSock.emit('join_room', interactionId);
        await new Promise(r => setTimeout(r, 300));

        const ownerGets = waitFor(ownerSock, 'receive_message');
        scannerSock.emit('send_message', { interactionId, text: 'Your car is blocking my gate' });
        const m1 = await ownerGets;
        check('Chat: scanner socket message → owner (senderRole derived)', m1.senderRole === 'scanner' && m1.text === 'Your car is blocking my gate');

        const scannerGets = waitFor(scannerSock, 'receive_message');
        ownerSock.emit('send_message', { interactionId, text: 'Coming in 5 minutes' });
        check('Chat: owner reply reaches scanner', (await scannerGets).senderRole === 'owner');

        const restMsg = await req('POST', `/interactions/${interactionId}/messages`, { text: 'thanks!' }, interactionToken);
        check('Chat: REST message fallback works', restMsg.status === 201 && restMsg.body.data.senderRole === 'scanner');

        // ---------- REPORT SHEET (in chat): POST /reports ----------
        const ownerEndSignal = waitFor(ownerSock, 'session_ended');
        const report = await req('POST', '/reports', { interactionId, category: 'Harassment', description: 'journey test' }, interactionToken);
        check('Report: 201 with ticketId, reporter derived from token', report.status === 201 && !!report.body.data.ticketId && report.body.data.reportedBy === 'scanner');
        check('Report: owner receives session_ended(reported)', (await ownerEndSignal).status === 'reported');
        check('Report: duplicate by same side → 409',
            (await req('POST', '/reports', { interactionId, category: 'Spam' }, interactionToken)).body.code === 'ALREADY_REPORTED');
        check('Report: closed session rejects messages',
            (await req('POST', `/interactions/${interactionId}/messages`, { text: 'x' }, interactionToken)).body.code === 'SESSION_ENDED');

        // ---------- 7-DAY REUSE: rescan, SAME scannerToken, no new OTP ----------
        const scan2 = await req('GET', `/scan/${vehicle.tagId}`);
        const create2 = await req('POST', `/scan/${vehicle.tagId}/interactions`,
            { scanToken: scan2.body.data.scanToken, scannerToken, type: 'Lights On' });
        check('Reuse: verified scanner skips OTP on rescan', create2.status === 201);

        // ---------- CROSS-TAG REUSE: a DIFFERENT owner's QR, same verified identity ----------
        // Verification is bound to the phone, not the tag — scanning any other
        // vehicle within the 7 days must not re-prompt for OTP.
        const owner2 = await req('POST', '/auth/verify-otp', { phoneNumber: '9876511003', otp: '999999' });
        const vehicleB = (await req('POST', '/vehicles', { vehicleName: 'Other Car', vehicleNumber: 'MH02ZZ1111' }, owner2.body.data.token)).body.data;
        const scanB = await req('GET', `/scan/${vehicleB.tagId}`);
        const createB = await req('POST', `/scan/${vehicleB.tagId}/interactions`,
            { scanToken: scanB.body.data.scanToken, scannerToken, type: 'Accident' });
        check('Cross-tag: same scanner token works on a different vehicle/owner', createB.status === 201);
        const crossView = await req('GET', `/interactions/${createB.body.data.interaction.interactionId}`, null, owner2.body.data.token);
        check('Cross-tag: second owner still sees the verified phone',
            crossView.body.data.scanner.phoneNumber === '+919876511002' && crossView.body.data.scanner.phoneVerified === true);
        const interaction2 = create2.body.data.interaction.interactionId;
        const interactionToken2 = create2.body.data.interactionToken;

        // ---------- END SESSION (chat footer action) ----------
        const scanner2 = io(`http://localhost:${PORT}`, { auth: { token: interactionToken2 }, transports: ['websocket'] });
        await waitFor(scanner2, 'connect');
        const ownerEnd2 = waitFor(ownerSock, 'interaction_update');
        scanner2.emit('end_session', { interactionId: interaction2 });
        const upd = await ownerEnd2;
        check('End: scanner ends session → owner notified(resolved)', upd.interactionId === interaction2 && upd.status === 'resolved');
        scanner2.close();

        // ---------- BLOCKING closes the loop on verified identity ----------
        await req('POST', '/users/me/blocked', { phoneNumber: SCANNER_PHONE_RAW, name: 'Journey Tester' }, ownerToken);
        const scan3 = await req('GET', `/scan/${vehicle.tagId}`);
        const blockedTry = await req('POST', `/scan/${vehicle.tagId}/interactions`,
            { scanToken: scan3.body.data.scanToken, scannerToken });
        check('Block: verified phone cannot start new interactions', blockedTry.status === 403 && blockedTry.body.code === 'BLOCKED_BY_OWNER');
    } catch (err) {
        console.error('JOURNEY CRASHED:', err.message);
        failures += 1;
    } finally {
        if (ownerSock) ownerSock.close();
        if (scannerSock) scannerSock.close();
        server.kill('SIGTERM');
        await new Promise(r => server.on('exit', r));
        await mongod.stop();
        console.log(failures ? `--- ${failures} FAILURE(S) ---` : '--- FULL SCANNER JOURNEY PASSED ---');
        process.exit(failures ? 1 : 0);
    }
})();
