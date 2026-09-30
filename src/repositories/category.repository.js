// ===== CATEGORY REPOSITORY =====
// Prisma persistence only; validation and deletion guards remain in services.

const { getPrismaClient } = require("../db/prisma");

const toId = (id) => {
    const value = Number(id);
    return Number.isInteger(value) ? value : null;
};

const toIsoString = (value) =>
    value === undefined || value === null
        ? value
        : value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString();

const mapCategory = (row) => row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        createdAt: toIsoString(row.createdAt)
    }
    : undefined;

const getAllCategories = async () => {
    const rows = await getPrismaClient().category.findMany({
        orderBy: { id: "asc" }
    });
    return rows.map(mapCategory);
};

const getCategoryById = async (id) => {
    const categoryId = toId(id);
    if (categoryId === null) return undefined;

    const row = await getPrismaClient().category.findUnique({
        where: { id: categoryId }
    });
    return mapCategory(row);
};

const getCategoryBySlug = async (slug) => {
    if (typeof slug !== "string") return undefined;

    const row = await getPrismaClient().category.findUnique({
        where: { slug }
    });
    return mapCategory(row);
};

const createCategory = async (categoryData = {}) => {
    const data = {
        name: categoryData.name,
        slug: categoryData.slug,
        description: categoryData.description
    };
    if (categoryData.createdAt !== undefined) data.createdAt = categoryData.createdAt;

    const row = await getPrismaClient().category.create({ data });
    return mapCategory(row);
};

const deleteCategory = async (id) => {
    const categoryId = toId(id);
    if (categoryId === null) return null;

    const prisma = getPrismaClient();
    const row = await prisma.category.findUnique({
        where: { id: categoryId }
    });
    if (!row) return null;

    await prisma.category.delete({
        where: { id: categoryId }
    });
    return mapCategory(row);
};

module.exports = {
    getAllCategories,
    getCategoryById,
    getCategoryBySlug,
    createCategory,
    deleteCategory,
    // Names used by the G3 repository outline and by integrations that use
    // the shorter lookup convention.
    getById: getCategoryById,
    getBySlug: getCategoryBySlug,
    findById: getCategoryById,
    findBySlug: getCategoryBySlug,
    getAll: getAllCategories,
    create: createCategory,
    getCategoryByID: getCategoryById,
    getByID: getCategoryById,
    delete: deleteCategory
};
