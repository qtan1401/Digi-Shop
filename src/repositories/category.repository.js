// ===== CATEGORY REPOSITORY =====
// Prisma persistence for administrator-managed categories. Slug uniqueness among undeleted rows is a partial unique
// index ("categories_slug_active_key"), so lookups by slug are findFirst, never findUnique.

const { getPrismaClient } = require("../db/prisma");

const CATEGORY_SELECT = {
    id: true,
    slug: true,
    name: true,
    sortOrder: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true
};

const ORDER = [{ sortOrder: "asc" }, { id: "asc" }];

const listActive = (client = getPrismaClient()) =>
    client.category.findMany({ where: { isDeleted: false }, orderBy: ORDER, select: CATEGORY_SELECT });

// Admin list; productCount counts undeleted products only.
const listWithProductCounts = ({ includeDeleted = false } = {}, client = getPrismaClient()) =>
    client.category.findMany({
        where: includeDeleted ? {} : { isDeleted: false },
        orderBy: ORDER,
        select: { ...CATEGORY_SELECT, _count: { select: { products: { where: { isDeleted: false } } } } }
    });

const findById = (id, client = getPrismaClient()) =>
    client.category.findFirst({ where: { id }, select: CATEGORY_SELECT });

const findActiveBySlug = (slug, client = getPrismaClient()) =>
    client.category.findFirst({ where: { slug, isDeleted: false }, select: CATEGORY_SELECT });

const maxSortOrder = async (client = getPrismaClient()) => {
    const result = await client.category.aggregate({ _max: { sortOrder: true } });
    return result._max.sortOrder;
};

const create = (data, client = getPrismaClient()) =>
    client.category.create({ data, select: CATEGORY_SELECT });

const update = (id, data, client = getPrismaClient()) =>
    client.category.update({ where: { id }, data, select: CATEGORY_SELECT });

const countProducts = (categoryId, { includeDeleted = false } = {}, client = getPrismaClient()) =>
    client.product.count({ where: includeDeleted ? { categoryId } : { categoryId, isDeleted: false } });

// Runs fn(tx, row) inside a transaction holding a row lock on the category (SELECT ... FOR UPDATE conflicts with the
// FOR KEY SHARE lock a concurrent product insert takes through the foreign key), so "is it in use?" checks cannot
// race with a product being added. row is undefined when the category does not exist.
const withCategoryLock = (id, fn, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM categories WHERE id = ${id} FOR UPDATE`;
        const row = await findById(id, tx);
        return fn(tx, row || undefined);
    });

module.exports = {
    listActive,
    listWithProductCounts,
    findById,
    findActiveBySlug,
    maxSortOrder,
    create,
    update,
    countProducts,
    withCategoryLock
};
