const { handleError, handleResponse } = require('../utils/requestHandlers');
const errorCodes = require('../config/errorCodes');

const mockRes = () => {
    const res = { headers: {}, req: { originalUrl: '/test', method: 'GET' } };
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('handleError', () => {
    test('curated error code drives status and machine-readable code', () => {
        const res = mockRes();
        handleError({ res, error: errorCodes.INVALID_OTP });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            message: errorCodes.INVALID_OTP.en,
            code: 'INVALID_OTP',
        }));
    });

    test('NEVER returns 200 for an error (the v1 bug)', () => {
        const res = mockRes();
        handleError({ res, error: new Error('boom') });
        expect(res.status).toHaveBeenCalledWith(500);
    });

    test('5xx from a raw Error hides internals from the client', () => {
        const res = mockRes();
        handleError({ res, error: new Error('mongodb://user:pass@10.0.0.5 failed') });
        const body = res.json.mock.calls[0][0];
        expect(body.message).toBe('Internal server error');
        expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    });

    test('Mongo duplicate key maps to 409', () => {
        const res = mockRes();
        handleError({ res, error: { code: 11000, keyPattern: { phoneNumber: 1 } } });
        expect(res.status).toHaveBeenCalledWith(409);
    });

    test('explicit call-site status wins over the curated code', () => {
        const res = mockRes();
        handleError({ res, error: errorCodes.INVALID_OTP, statusCode: 401 });
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('handleResponse', () => {
    test('uniform success envelope', () => {
        const res = mockRes();
        handleResponse({ res, data: { a: 1 } });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Success', data: { a: 1 } });
    });
});
