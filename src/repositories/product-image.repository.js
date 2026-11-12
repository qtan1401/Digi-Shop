// ===== PRODUCT IMAGE REPOSITORY =====
// Persistence of a Product's gallery rows (the extra photos kept in order by position; position 0 is the main photo
// on the Product itself, so gallery positions start at 1). Runs inside the caller's transaction.

/**
 * Apply a validated gallery plan: delete `removeIds`, then store `ordered` as positions 1..n.
 * Kept photos are parked on negative positions first so the (product, position) unique index is never hit mid-way.
 * @param {Object} transaction Prisma transaction client.
 * @param {number} productId
 * @param {{removeIds: number[], ordered: Array<{id?: number, url?: string}>}|null|undefined} plan
 */
const applyGalleryPlan = async (transaction, productId, plan) => {
    if (!plan) return;
    if (plan.removeIds.length > 0) {
        await transaction.productImage.deleteMany({ where: { productId, id: { in: plan.removeIds } } });
    }
    for (const entry of plan.ordered) {
        if (entry.id !== undefined) {
            await transaction.productImage.update({ where: { id: entry.id }, data: { position: -entry.id } });
        }
    }
    for (const [index, entry] of plan.ordered.entries()) {
        const position = index + 1;
        if (entry.id !== undefined) {
            await transaction.productImage.update({ where: { id: entry.id }, data: { position } });
        } else {
            await transaction.productImage.create({ data: { productId, url: entry.url, position } });
        }
    }
};

module.exports = { applyGalleryPlan };
