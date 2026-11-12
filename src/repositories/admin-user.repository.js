// ===== ADMIN USER REPOSITORY =====
// Read side of customer management. Status changes go through auth.repository.setUserStatus.

const { getPrismaClient } = require("../db/prisma");

const LIST_SELECT = {
    id: true,
    email: true,
    username: true,
    fullName: true,
    role: true,
    status: true,
    emailVerifiedAt: true,
    loyaltyPoints: true,
    createdAt: true,
    _count: { select: { orders: true } }
};

const mapRow = (row) => ({
    id: row.id,
    email: row.email ?? null,
    username: row.username ?? null,
    fullName: row.fullName ?? null,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.emailVerifiedAt),
    orderCount: row._count?.orders ?? 0,
    loyaltyPoints: row.loyaltyPoints ?? 0,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString()
});

const customerWhere = (search) => {
    const where = { role: "user" };
    if (search) {
        where.OR = [
            { email: { contains: search } },
            { fullName: { contains: search } },
            { username: { contains: search } }
        ];
    }
    return where;
};

/** One page of customer accounts (never administrators), newest first, plus the total matching the search. */
const listCustomers = async ({ search, skip, take }) => {
    const client = getPrismaClient();
    const where = customerWhere(search);
    const [rows, total] = await Promise.all([
        client.user.findMany({ where, select: LIST_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take }),
        client.user.count({ where })
    ]);
    return { rows: rows.map(mapRow), total };
};

/** Any account (customer or administrator) by id, in the list shape; undefined when missing. */
const findAccount = async (id) => {
    const row = await getPrismaClient().user.findUnique({ where: { id }, select: LIST_SELECT });
    return row ? mapRow(row) : undefined;
};

module.exports = { listCustomers, findAccount };
