const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");

const ADMIN_USER_SELECT = {
    id: true,
    username: true,
    role: true,
    forcePasswordChange: true
};

const createAdmin = async ({ username, passwordHash }, client = getPrismaClient()) =>
    client.user.create({
        data: {
            id: crypto.randomUUID(),
            username,
            passwordHash,
            role: "admin",
            status: "ACTIVE",
            forcePasswordChange: true,
            failedPasswordAttempts: 0,
            authVersion: 1
        },
        select: ADMIN_USER_SELECT
    });

module.exports = { createAdmin };
