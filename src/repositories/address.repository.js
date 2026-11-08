const { getPrismaClient } = require("../db/prisma");

const ADDRESS_SELECT = {
    id: true,
    recipientName: true,
    phone: true,
    addressLine: true,
    isDefault: true,
    createdAt: true,
    updatedAt: true
};

// Runs fn(tx) in a transaction that first touches the user's row, so two concurrent writes for the same
// user queue up instead of both seeing "no default yet" or "9 of 10 addresses".
const withUserLock = (userId, fn, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() }, select: { id: true } });
        return fn(tx);
    });

const listByUser = (userId, client = getPrismaClient()) =>
    client.userAddress.findMany({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        select: ADDRESS_SELECT
    });

const countByUser = (userId, client = getPrismaClient()) => client.userAddress.count({ where: { userId } });

// Every query is scoped by userId: another user's address id is simply "not found".
const findOwned = (userId, id, client = getPrismaClient()) =>
    client.userAddress.findFirst({ where: { id, userId }, select: ADDRESS_SELECT });

const findNewestByUser = (userId, client = getPrismaClient()) =>
    client.userAddress.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: ADDRESS_SELECT });

const create = (data, client = getPrismaClient()) =>
    client.userAddress.create({ data, select: ADDRESS_SELECT });

const update = (userId, id, data, client = getPrismaClient()) =>
    client.userAddress.updateMany({ where: { id, userId }, data });

const remove = (userId, id, client = getPrismaClient()) =>
    client.userAddress.deleteMany({ where: { id, userId } });

const clearDefault = (userId, client = getPrismaClient()) =>
    client.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });

module.exports = { withUserLock, listByUser, countByUser, findOwned, findNewestByUser, create, update, remove, clearDefault };
