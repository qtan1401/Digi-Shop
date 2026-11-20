const { randomBytes } = require("node:crypto");
const os = require("node:os");

const configuredInstanceId = process.env.INSTANCE_ID?.trim();
const revision = process.env.K_REVISION?.trim();
const instanceId = configuredInstanceId || (revision
    ? `${revision}-${randomBytes(3).toString("hex")}`
    : `${os.hostname()}:${process.env.PORT || 3000}`);

module.exports = { instanceId };
