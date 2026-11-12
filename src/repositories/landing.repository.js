// ===== LANDING REPOSITORY =====
// Read-only Prisma queries behind the landing page: newest Products, best sellers and the newest Products per device type.
// Every list holds Product summaries (the shape of a catalog card) and only Products that can still be bought.

const { getPrismaClient } = require("../db/prisma");
const { Prisma } = require("@prisma/client");

const SUMMARY_INCLUDE = { variants: { where: { isActive: true }, select: { price: true, stock: true } } };
const VISIBLE = { isDeleted: false, variants: { some: { isActive: true } } };
const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }];

const toSummary = (row) => {
    const prices = (row.variants || []).map((variant) => Number(variant.price)).filter(Number.isFinite);
    return {
        id: row.id,
        brand: row.brand,
        deviceType: row.deviceType,
        name: row.name,
        image: row.image,
        price: prices.length ? Math.min(...prices) : 0,
        priceMax: prices.length ? Math.max(...prices) : 0,
        stock: row.variants.reduce((total, variant) => total + Number(variant.stock || 0), 0),
        variantCount: row.variants.length
    };
};

const findNewest = async (limit, deviceType) => {
    const rows = await getPrismaClient().product.findMany({
        where: deviceType ? { ...VISIBLE, deviceType } : VISIBLE,
        orderBy: NEWEST_FIRST,
        take: limit,
        include: SUMMARY_INCLUDE
    });
    return rows.map(toSummary);
};

/**
 * Best sellers: Products ranked by units sold in Orders that are not CANCELLED. Units sold since `since` rank first;
 * units sold at any time break ties, so a Product with no recent sale still fills a short list.
 */
const findBestSellers = async (limit, since) => {
    const client = getPrismaClient();
    const ranked = await client.$queryRaw(Prisma.sql`
        SELECT TOP (${limit}) v.product_id AS id,
            SUM(CASE WHEN o.created_at >= ${since} THEN oi.quantity ELSE 0 END) AS recent_units,
            SUM(oi.quantity) AS total_units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN product_variants v ON v.id = oi.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE o.order_status <> 'CANCELLED' AND p.is_deleted = 0
            AND EXISTS (SELECT 1 FROM product_variants active WHERE active.product_id = p.id AND active.is_active = 1)
        GROUP BY v.product_id
        ORDER BY recent_units DESC, total_units DESC, v.product_id ASC
    `);
    const ids = ranked.map((row) => Number(row.id));
    if (!ids.length) return [];
    const rows = await client.product.findMany({ where: { id: { in: ids } }, include: SUMMARY_INCLUDE });
    const byId = new Map(rows.map((row) => [row.id, toSummary(row)]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
};

module.exports = { findNewest, findBestSellers };
