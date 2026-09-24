// JWT `purpose` claims. Session tokens (owners) carry no purpose for backwards
// simplicity; scoped tokens always do, and every verifier checks it.
const TOKEN_PURPOSE = {
    SCAN: 'scan',               // issued on GET /scan/:tagId — single-use, short TTL
    SCANNER: 'scanner',         // issued on scanner OTP verify — carries the VERIFIED phone (24h)
    INTERACTION: 'interaction', // issued on interaction create — scanner's session for ONE interaction
};

const REFRESHED_TOKEN_HEADER = 'x-refreshed-token';

module.exports = { TOKEN_PURPOSE, REFRESHED_TOKEN_HEADER };
