const db = require('./helpers/db');
const otpService = require('../dbServices/otpService');
const OtpModel = require('../models/otpModel');
const config = require('../config/config');

const PHONE = '+919999900001';

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(db.clear);

describe('otpService', () => {
    test('verify consumes the OTP — second use fails', async () => {
        const otp = await otpService.issue(PHONE);
        await expect(otpService.verifyAndConsume(PHONE, otp)).resolves.toBe(true);
        await expect(otpService.verifyAndConsume(PHONE, otp)).rejects.toMatchObject({ code: 'INVALID_OTP' });
    });

    test('expired OTP is rejected', async () => {
        const otp = await otpService.issue(PHONE);
        await OtpModel.updateOne({ phoneNumber: PHONE }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        await expect(otpService.verifyAndConsume(PHONE, otp)).rejects.toMatchObject({ code: 'INVALID_OTP' });
    });

    test('issuing a new OTP invalidates the previous one', async () => {
        const first = await otpService.issue(PHONE);
        await otpService.issue(PHONE);
        await expect(otpService.verifyAndConsume(PHONE, first)).rejects.toMatchObject({ code: 'INVALID_OTP' });
    });

    test('attempt cap: after max wrong tries even the correct OTP is rejected', async () => {
        const otp = await otpService.issue(PHONE);
        for (let i = 0; i < config.otp.maxAttempts; i += 1) {
            await expect(otpService.verifyAndConsume(PHONE, '000000')).rejects.toMatchObject({
                code: expect.stringMatching(/INVALID_OTP|OTP_ATTEMPTS_EXCEEDED/),
            });
        }
        // Once the cap is hit, even the correct code is refused — and the error
        // says why, so the client can prompt for a fresh OTP.
        await expect(otpService.verifyAndConsume(PHONE, otp)).rejects.toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED' });
    });

    test('master OTP verifies without a stored OTP', async () => {
        await expect(otpService.verifyAndConsume(PHONE, config.otp.masterOtp)).resolves.toBe(true);
    });

    test('OTP is stored hashed, never in plaintext', async () => {
        const otp = await otpService.issue(PHONE);
        const doc = await OtpModel.findOne({ phoneNumber: PHONE }).lean();
        expect(doc.otpHash).toBeDefined();
        expect(doc.otpHash).not.toBe(otp);
        expect(JSON.stringify(doc)).not.toContain(otp);
    });
});
