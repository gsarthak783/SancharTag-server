const INTERACTION_STATUS = {
    ACTIVE: 'active',
    COMPLETED: 'completed',
    RESOLVED: 'resolved',
    REPORTED: 'reported',
    BLOCKED: 'blocked',
    MISSED: 'missed',
};

const CONTACT_TYPE = {
    SCAN: 'scan',
    CHAT: 'chat',
    CALL: 'call',
};

const SENDER_ROLE = {
    OWNER: 'owner',
    SCANNER: 'scanner',
};

const MESSAGE_TYPE = {
    TEXT: 'text',
    CALL: 'call',
};

const MESSAGE_MAX_LENGTH = 2000;

// Status values an owner may set directly via the API (others are system-set).
const OWNER_SETTABLE_STATUSES = [
    INTERACTION_STATUS.ACTIVE,
    INTERACTION_STATUS.COMPLETED,
    INTERACTION_STATUS.RESOLVED,
];

module.exports = {
    INTERACTION_STATUS,
    CONTACT_TYPE,
    SENDER_ROLE,
    MESSAGE_TYPE,
    MESSAGE_MAX_LENGTH,
    OWNER_SETTABLE_STATUSES,
};
