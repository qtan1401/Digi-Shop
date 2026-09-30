// ===== AUDIT LOG REPOSITORY =====
// Prisma persistence; changes are stored as JSON and exposed as objects.

const { getPrismaClient } = require("../db/prisma");

let nextAuditSequence = 0;

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const toDate = (value) =>
    value === undefined || value === null || value instanceof Date
        ? value
        : new Date(value);

const mapEntityId = (value) => {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return value;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
};

const mapAuditLog = (row) => row
    ? {
        id: row.id,
        actor: row.actor,
        action: row.action,
        entity: row.entity,
        entityId: mapEntityId(row.entityId),
        changes: JSON.parse(row.changesJson),
        timestamp: toIsoString(row.timestamp)
    }
    : undefined;

const createLog = async (logData = {}) => {
    const data = {
        id: logData.id || `AUD-${Date.now()}-${++nextAuditSequence}`,
        actor: logData.actor,
        action: logData.action,
        entity: logData.entity,
        entityId: String(logData.entityId),
        changesJson: JSON.stringify(
            logData.changes === undefined ? null : logData.changes
        )
    };
    if (logData.timestamp !== undefined) data.timestamp = toDate(logData.timestamp);

    const row = await getPrismaClient().auditLog.create({ data });
    return mapAuditLog(row);
};

const getAllLogs = async () => {
    const rows = await getPrismaClient().auditLog.findMany({
        orderBy: [
            { timestamp: "desc" },
            { id: "desc" }
        ]
    });
    return rows.map(mapAuditLog);
};

module.exports = {
    createLog,
    getAllLogs,
    create: createLog,
    getAll: getAllLogs
};
