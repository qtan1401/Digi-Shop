// ===== TAG REPOSITORY =====
// Prisma persistence for tags and the product_tags link table. Slug uniqueness among undeleted rows is a partial
// unique index ("tags_slug_active_key"), so lookups by slug are findFirst, never findUnique.

const { getPrismaClient } = require("../db/prisma");

const TAG_SELECT = {
    id: true,
    slug: true,
    name: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true
};

const ORDER = [{ name: "asc" }, { id: "asc" }];

const listActive = (client = getPrismaClient()) =>
    client.tag.findMany({ where: { isDeleted: false }, orderBy: ORDER, select: TAG_SELECT });

// Admin list; productCount counts undeleted products only.
const listWithProductCounts = ({ includeDeleted = false } = {}, client = getPrismaClient()) =>
    client.tag.findMany({
        where: includeDeleted ? {} : { isDeleted: false },
        orderBy: ORDER,
        select: { ...TAG_SELECT, _count: { select: { products: { where: { product: { isDeleted: false } } } } } }
    });

const findById = (id, client = getPrismaClient()) =>
    client.tag.findFirst({ where: { id }, select: TAG_SELECT });

const findActiveBySlug = (slug, client = getPrismaClient()) =>
    client.tag.findFirst({ where: { slug, isDeleted: false }, select: TAG_SELECT });

const findActiveByIds = (ids, client = getPrismaClient()) =>
    client.tag.findMany({ where: { id: { in: ids }, isDeleted: false }, orderBy: ORDER, select: TAG_SELECT });

const create = (data, client = getPrismaClient()) =>
    client.tag.create({ data, select: TAG_SELECT });

const update = (id, data, client = getPrismaClient()) =>
    client.tag.update({ where: { id }, data, select: TAG_SELECT });

// Soft delete also drops the links, so the tag disappears from every product at once.
const softDelete = (id, client = getPrismaClient()) =>
    client.$transaction(async (tx) => {
        const rows = await tx.$queryRaw`SELECT is_deleted AS "isDeleted" FROM tags WHERE id = ${id} FOR UPDATE`;
        if (rows.length === 0 || rows[0].isDeleted) return undefined;
        await tx.productTag.deleteMany({ where: { tagId: id } });
        return tx.tag.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() }, select: TAG_SELECT });
    });

const findProduct = (productId, client = getPrismaClient()) =>
    client.product.findFirst({ where: { id: productId }, select: { id: true } });

// Undeleted tags of one product, in tag order.
const listForProduct = (productId, client = getPrismaClient()) =>
    client.tag.findMany({
        where: { isDeleted: false, products: { some: { productId } } },
        orderBy: ORDER,
        select: TAG_SELECT
    });

// Link rows of many products (listing pages); callers filter on tag.isDeleted through the include.
const listLinksForProducts = (productIds, client = getPrismaClient()) =>
    client.productTag.findMany({
        where: { productId: { in: productIds }, tag: { isDeleted: false } },
        select: { productId: true, tag: { select: TAG_SELECT } }
    });

// Replaces the whole tag set atomically. Lock the product and tag rows so a concurrent tag deletion cannot leave
// a product_tags link pointing at a deleted tag after the deletion removed its links.
const replaceProductTags = (productId, tagIds, client = getPrismaClient()) => {
    const replace = async (tx) => {
        const locked = await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;
        if (locked.length === 0) return undefined;
        for (const tagId of [...tagIds].sort((left, right) => left - right)) {
            const rows = await tx.$queryRaw`SELECT is_deleted AS "isDeleted" FROM tags WHERE id = ${tagId} FOR UPDATE`;
            if (rows.length === 0 || rows[0].isDeleted) return null;
        }
        await tx.productTag.deleteMany({ where: { productId } });
        if (tagIds.length > 0) {
            await tx.productTag.createMany({ data: tagIds.map((tagId) => ({ productId, tagId })) });
        }
        return listForProduct(productId, tx);
    };
    return typeof client.$transaction === "function" ? client.$transaction(replace) : replace(client);
};

module.exports = {
    listActive,
    listWithProductCounts,
    findById,
    findActiveBySlug,
    findActiveByIds,
    create,
    update,
    softDelete,
    findProduct,
    listForProduct,
    listLinksForProducts,
    replaceProductTags
};
