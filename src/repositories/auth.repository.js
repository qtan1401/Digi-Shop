const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");

const USER_SELECT = {
    id: true,
    email: true,
    username: true,
    passwordHash: true,
    role: true,
    status: true,
    emailVerifiedAt: true,
    failedPasswordAttempts: true,
    passwordLockedAt: true,
    forcePasswordChange: true,
    authVersion: true
};

const mapUser = (user) => user ? { ...user } : null;

const findUserByEmail = async (email, client = getPrismaClient()) =>
    mapUser(await client.user.findFirst({ where: { email }, select: USER_SELECT }));

const findUserByUsername = async (username, client = getPrismaClient()) =>
    mapUser(await client.user.findUnique({ where: { username }, select: USER_SELECT }));

const findUserById = async (id, client = getPrismaClient()) =>
    mapUser(await client.user.findUnique({ where: { id }, select: USER_SELECT }));

const findUserByIdentifier = async (identifier, client = getPrismaClient()) =>
    mapUser(await client.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }] },
        select: USER_SELECT
    }));

const createUser = async (data, client = getPrismaClient()) =>
    mapUser(await client.user.create({ data, select: USER_SELECT }));

const createUserWithGoogle = async ({ user, identity }, client = getPrismaClient()) => {
    return client.$transaction(async (tx) => {
        const created = await tx.user.create({ data: user, select: USER_SELECT });
        await tx.oAuthIdentity.create({ data: { ...identity, userId: created.id } });
        return mapUser(created);
    });
};

const findOAuthIdentity = async (provider, providerSubject, client = getPrismaClient()) =>
    client.oAuthIdentity.findUnique({
        where: { provider_providerSubject: { provider, providerSubject } },
        include: { user: { select: USER_SELECT } }
    });

const createOAuthIdentity = async ({ userId, provider, providerSubject, emailSnapshot }, client = getPrismaClient()) =>
    client.oAuthIdentity.create({ data: { id: crypto.randomUUID(), userId, provider, providerSubject, emailSnapshot } });

const createEmailVerificationToken = async ({ userId, tokenHash, expiresAt }, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        await tx.emailVerificationToken.updateMany({
            where: { userId, usedAt: null },
            data: { usedAt: new Date() }
        });
        return tx.emailVerificationToken.create({
            data: { id: crypto.randomUUID(), userId, tokenHash, expiresAt }
        });
    });
const getEmailVerificationToken = async (tokenHash, client = getPrismaClient()) =>
    client.emailVerificationToken.findUnique({ where: { tokenHash } });

const consumeEmailVerificationToken = async ({ tokenHash, now }, client = getPrismaClient()) => {
    return client.$transaction(async (tx) => {
        const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
        if (!token) return { state: "INVALID" };
        if (token.usedAt) return { state: "INVALID" };
        if (token.expiresAt <= now) return { state: "EXPIRED" };
        const consumed = await tx.emailVerificationToken.updateMany({
            where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now }
        });
        if (consumed.count !== 1) return { state: "INVALID" };
        const updated = await tx.user.update({
            where: { id: token.userId },
            data: { status: "ACTIVE", emailVerifiedAt: now },
            select: USER_SELECT
        });
        return { state: "VERIFIED", user: mapUser(updated) };
    });
};
const activateUser = async (userId, now = new Date(), client = getPrismaClient()) =>
    mapUser(await client.user.update({
        where: { id: userId },
        data: { status: "ACTIVE", emailVerifiedAt: now },
        select: USER_SELECT
    }));

const incrementFailedPasswordAttempts = async (userId, client = getPrismaClient()) => {
    const count = await client.$executeRaw`
        UPDATE [dbo].[users]
        SET [failed_password_attempts] = [failed_password_attempts] + 1,
            [password_locked_at] = CASE
                WHEN [failed_password_attempts] + 1 >= 5 THEN SYSUTCDATETIME()
                ELSE [password_locked_at]
            END,
            [updated_at] = SYSUTCDATETIME()
        WHERE [id] = ${userId}
          AND [role] = N'user'
          AND [password_hash] IS NOT NULL
          AND [password_locked_at] IS NULL
          AND [failed_password_attempts] < 5;
    `;
    return count > 0;
};

const resetFailedPasswordAttempts = async (userId, client = getPrismaClient()) =>
    client.user.update({
        where: { id: userId },
        data: { failedPasswordAttempts: 0, passwordLockedAt: null },
        select: USER_SELECT
    }).then(mapUser);

const updatePasswordAndRevoke = async ({ userId, expectedAuthVersion, passwordHash, forcePasswordChange = false }, client = getPrismaClient()) => {
    return client.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
            where: { id: userId, authVersion: expectedAuthVersion },
            data: {
                passwordHash,
                failedPasswordAttempts: 0,
                passwordLockedAt: null,
                forcePasswordChange,
                authVersion: { increment: 1 }
            }
        });
        if (changed.count !== 1) return null;
        await tx.refreshSession.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() }
        });
        return mapUser(await tx.user.findUnique({ where: { id: userId }, select: USER_SELECT }));
    });
};

const commitRecovery = async ({ userId, expectedAuthVersion, passwordHash }, client = getPrismaClient()) =>
    updatePasswordAndRevoke({ userId, expectedAuthVersion, passwordHash, forcePasswordChange: true }, client);

const createRefreshSession = async (data, client = getPrismaClient()) =>
    client.refreshSession.create({ data });

const findRefreshSession = async (tokenHash, client = getPrismaClient()) =>
    client.refreshSession.findUnique({
        where: { tokenHash },
        include: { user: { select: USER_SELECT } }
    });

const rotateRefreshSession = async ({ oldTokenHash, newTokenHash, now = new Date() }, client = getPrismaClient()) => {
    return client.$transaction(async (tx) => {
        const oldSession = await tx.refreshSession.findUnique({
            where: { tokenHash: oldTokenHash },
            include: { user: { select: USER_SELECT } }
        });
        if (!oldSession) return { state: "INVALID" };
        if (oldSession.revokedAt || oldSession.replacedById) {
            if (oldSession.replacedById) {
                await tx.refreshSession.updateMany({
                    where: { familyId: oldSession.familyId, revokedAt: null },
                    data: { revokedAt: now }
                });
                return { state: "REUSED" };
            }
            return { state: "INVALID" };
        }
        if (oldSession.expiresAt <= now) return { state: "INVALID" };
        const newSession = {
            id: crypto.randomUUID(),
            userId: oldSession.userId,
            familyId: oldSession.familyId,
            tokenHash: newTokenHash,
            remembered: oldSession.remembered,
            expiresAt: new Date(now.getTime() + (oldSession.remembered ? 7 : 1) * 24 * 60 * 60 * 1000),
            createdAt: now,
            lastUsedAt: now
        };
        // The FK on replacedById requires the replacement row to exist first.
        // Keep both writes in this transaction so a concurrent reuse still
        // revokes the family without leaving an unlinked active token.
        const created = await tx.refreshSession.create({ data: newSession });
        const revoked = await tx.refreshSession.updateMany({
            where: { id: oldSession.id, revokedAt: null, replacedById: null },
            data: { revokedAt: now, lastUsedAt: now, replacedById: newSession.id }
        });
        if (revoked.count !== 1) {
            await tx.refreshSession.delete({ where: { id: newSession.id } });
            await tx.refreshSession.updateMany({
                where: { familyId: oldSession.familyId, revokedAt: null },
                data: { revokedAt: now }
            });
            return { state: "REUSED" };
        }
        return { state: "ROTATED", session: created, user: mapUser(oldSession.user) };
    });
};

const revokeFamily = async (familyId, client = getPrismaClient()) =>
    client.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });

const revokeUserSessionsAndIncrementVersion = async (userId, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
        return mapUser(await tx.user.update({
            where: { id: userId },
            data: { authVersion: { increment: 1 } },
            select: USER_SELECT
        }));
    });

module.exports = {
    USER_SELECT,
    mapUser,
    findUserByEmail,
    findUserByUsername,
    findUserById,
    findUserByIdentifier,
    createUser,
    createUserWithGoogle,
    findOAuthIdentity,
    createOAuthIdentity,
    createEmailVerificationToken,
    getEmailVerificationToken,
    consumeEmailVerificationToken,
    activateUser,
    incrementFailedPasswordAttempts,
    resetFailedPasswordAttempts,
    updatePasswordAndRevoke,
    commitRecovery,
    createRefreshSession,
    findRefreshSession,
    rotateRefreshSession,
    revokeFamily,
    revokeUserSessionsAndIncrementVersion
};
