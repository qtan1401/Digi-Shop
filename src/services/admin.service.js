// ===== ADMIN SERVICE =====
// Coordinates admin-facing catalog mutations and their audit entries.
// Domain validation and state transitions remain in the category/product services.

const productService = require("./product.service");
const categoryService = require("./category.service");
const productRepository = require("../repositories/product.repository");
const auditRepository = require("../repositories/audit.repository");

const actorFor = (actor) => actor || "admin";
const snapshot = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const diff = (before, after) => {
    const changes = {};
    const keys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {})
    ]);

    for (const key of keys) {
        if (key === "updatedAt") continue;
        const oldValue = before ? before[key] : undefined;
        const newValue = after ? after[key] : undefined;
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            changes[key] = { old: oldValue, new: newValue };
        }
    }
    return changes;
};

const writeAudit = (actor, action, entity, entityId, changes) =>
    auditRepository.createLog({
        actor: actorFor(actor),
        action,
        entity,
        entityId,
        changes
    });

const createCategory = (input, actor) => {
    const category = categoryService.createCategory(input);
    writeAudit(actor, "CREATE", "category", category.id, {
        name: { old: undefined, new: category.name },
        slug: { old: undefined, new: category.slug },
        description: { old: undefined, new: category.description }
    });
    return category;
};

const deleteCategory = (id, actor) => {
    // Inject the repository at the boundary to avoid a category-service/product-
    // repository circular import while keeping the guard on the domain service.
    const category = categoryService.findCategoryById(id);
    const deleted = categoryService.deleteCategory(id, productRepository);
    writeAudit(actor, "DELETE", "category", deleted.id, {
        category: { old: category, new: undefined }
    });
    return deleted;
};

const getProducts = (filters) => productService.getAdminProducts(filters);
const getProduct = (id) => productService.getProductByID(id, { includeDeleted: true });

const createProduct = (input, actor) => {
    const product = productService.createProduct(input);
    writeAudit(actor, "CREATE", "product", product.id, diff(undefined, product));
    return product;
};

const updateProduct = (id, input, actor) => {
    const before = snapshot(productService.getProductByID(id, { includeDeleted: true }));
    const product = productService.updateProduct(id, input);
    writeAudit(actor, "UPDATE", "product", product.id, diff(before, product));
    return product;
};

const softDeleteProduct = (id, actor) => {
    const before = snapshot(productService.getProductByID(id, { includeDeleted: true }));
    const product = productService.softDeleteProduct(id);
    writeAudit(actor, "SOFT_DELETE", "product", product.id, diff(before, product));
    return product;
};

const restoreProduct = (id, options, actor) => {
    const before = snapshot(productService.getProductByID(id, { includeDeleted: true }));
    const product = productService.restoreProduct(id, options);
    writeAudit(actor, "RESTORE", "product", product.id, diff(before, product));
    return product;
};

const getAuditLogs = () => auditRepository.getAllLogs();

module.exports = {
    createCategory,
    deleteCategory,
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    softDeleteProduct,
    restoreProduct,
    getAuditLogs,
    writeAudit,
    getAdminProducts: getProducts,
    getProductById: getProduct,
    getProductByID: getProduct,
    deleteProduct: softDeleteProduct,
    restore: restoreProduct,
    getAllAuditLogs: getAuditLogs
};
