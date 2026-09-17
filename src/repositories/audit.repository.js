// ===== AUDIT LOG REPOSITORY =====
// Repository owns access to the in-memory audit log collection.

const auditLogs = require("../models/audit.model");

let nextAuditSequence = 0;

const createLog = (logData = {}) => {
    const timestamp = logData.timestamp || new Date().toISOString();
    const log = {
        ...logData,
        id: logData.id || `AUD-${Date.now()}-${++nextAuditSequence}`,
        timestamp
    };
    auditLogs.push(log);
    return log;
};

const getAllLogs = () => auditLogs
    .map((log, index) => ({ log, index }))
    .sort((a, b) => {
        const timestampOrder = new Date(b.log.timestamp).getTime() - new Date(a.log.timestamp).getTime();
        return timestampOrder || b.index - a.index;
    })
    .map(({ log }) => log);

module.exports = {
    createLog,
    getAllLogs,
    create: createLog,
    getAll: getAllLogs
};
