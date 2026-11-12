const crypto = require("crypto");
const { getPrismaClient } = require("../db/prisma");

const USER_SELECT = {
    id: true,
    email: true,
    username: true,
    fullName: true,
    passwordHash: true,
    role: true,
    status: true,
    emailVerifiedAt: true,
    failedPasswordAttempts: true,
    passwordLockedAt: true,
    forcePasswordChange: true,
    authVersion: true,
    loyaltyPoints: true
};

const mapUser = (user) => user ? { ...user } : null;

const findUserByEmail = async (email, client = getPrismaClient()) =>
    mapUser(await client.user.findFirst({ where: { email }, select: USER_SELECT }));

const findUserByUsername = async (username, client = getPrismaClient()) =>
    mapUser(await client.user.findFirst({ where: { username }, select: USER_SELECT }));

const findUserById = async (id, client = getPrismaClient()) =>
    mapUser(await client.user.findUnique({ where: { id }, select: USER_SELECT }));

const findUserByIdentifier = async (identifier, client = getPrismaClient()) =>
    mapUser(await client.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }] },
        select: USER_SELECT
    }));

const createUser = async (data, client = getPrismaClient()) =>
    mapUser(await client.user.create({ data, select: USER_SELECT }));

// Race-safe set-once: only a customer row whose username is still NULL is updated.
const setUsernameIfUnset = async ({ userId, username }, client = getPrismaClient()) => {
    const result = await client.user.updateMany({
        where: { id: userId, role: "user", username: null },
        data: { username }
    });
    if (result.count !== 1) return null;
    return findUserById(userId, client);
};

const updateFullName = async ({ userId, fullName }, client = getPrismaClient()) =>
    mapUser(await client.user.update({ where: { id: userId }, data: { fullName }, select: USER_SELECT }));

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
        // A banned account is never reactivated by an old verification link.
        const owner = await tx.user.findUnique({ where: { id: token.userId }, select: { status: true } });
        if (owner && owner.status === "BANNED") return { state: "INVALID" };
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


// A newer reset link replaces every earlier unused one, atomically with storing the new hash.
const createPasswordResetToken = async ({ userId, tokenHash, expiresAt }, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
        return tx.passwordResetToken.create({ data: { id: crypto.randomUUID(), userId, tokenHash, expiresAt } });
    });

/**
 * Spends a reset token and sets the new password in one transaction. The claim (usedAt null, not expired, count 1) is
 * the only gate, so of two concurrent uses exactly one wins. A passwordless account (guest or new registration) becomes
 * ACTIVE: opening the link proves the mailbox. Returns { state: "RESET" | "INVALID" }.
 */
const resetPasswordWithToken = async ({ tokenHash, passwordHash, now }, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
            where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now }
        });
        if (claimed.count !== 1) return { state: "INVALID" };
        const token = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
        const user = token && await tx.user.findUnique({ where: { id: token.userId }, select: USER_SELECT });
        if (!user || user.role !== "user") throw new ResetAbort();
        const activate = user.status === "UNVERIFIED" && !user.passwordHash;
        if (user.status !== "ACTIVE" && !activate) throw new ResetAbort();
        const changed = await tx.user.updateMany({
            where: { id: user.id, authVersion: user.authVersion },
            data: {
                passwordHash,
                failedPasswordAttempts: 0,
                passwordLockedAt: null,
                forcePasswordChange: false,
                authVersion: { increment: 1 },
                ...(activate ? { status: "ACTIVE", emailVerifiedAt: now } : {})
            }
        });
        if (changed.count !== 1) throw new ResetAbort();
        await tx.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
        return { state: "RESET" };
    }).catch((error) => {
        // Rolled back: the token is still unused, so a user who lost a race can simply try again.
        if (error instanceof ResetAbort) return { state: "INVALID" };
        throw error;
    });

class ResetAbort extends Error {}

/** How many orders an account has; used only to tell a never-used guest account from one that already ordered. */
const countOrdersByUser = async (userId, client = getPrismaClient()) =>
    client.order.count({ where: { userId } });

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

/**
 * Admin ban / unban. Banning bumps authVersion and revokes every refresh session in the same transaction, so a
 * session the customer already holds stops working at once. Unbanning only changes the status.
 */
const setUserStatus = async ({ userId, status }, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        if (status === "BANNED") {
            await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        return mapUser(await tx.user.update({
            where: { id: userId },
            data: status === "BANNED" ? { status, authVersion: { increment: 1 } } : { status },
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
    setUsernameIfUnset,
    updateFullName,
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
    createPasswordResetToken,
    resetPasswordWithToken,
    countOrdersByUser,
    createRefreshSession,
    findRefreshSession,
    rotateRefreshSession,
    revokeFamily,
    revokeUserSessionsAndIncrementVersion,
    setUserStatus
};
