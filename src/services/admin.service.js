// ===== ADMIN SERVICE =====
// Coordinates admin-facing catalog mutations and their audit entries.
// Domain validation and state transitions remain in the Product service.

const productService = require("./product.service");
const auditRepository = require("../repositories/audit.repository");
const adminAccountRepository = require("../repositories/admin-account.repository");
const { normalizeUsername, hashPassword } = require("./auth.service");

class AdminAccountError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = "AdminAccountError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

const accountUsername = (value) =>
    typeof value === "string" ? normalizeUsername(value) : "";

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

const writeAudit = async (actor, action, entity, entityId, changes) =>
    await auditRepository.createLog({
        actor: actorFor(actor),
        action,
        entity,
        entityId,
        changes
    });


const getProducts = async (filters) => await productService.getAdminProducts(filters);
const getProduct = async (id) =>
    await productService.getProductByID(id, { includeDeleted: true });

const createProduct = async (input, actor) => {
    const product = await productService.createProduct(input);
    await writeAudit(actor, "CREATE", "product", product.id, diff(undefined, product));
    return product;
};

const updateProduct = async (id, input, actor) => {
    const before = snapshot(await productService.getProductByID(id, { includeDeleted: true }));
    const product = await productService.updateProduct(id, input);
    await writeAudit(actor, "UPDATE", "product", product.id, diff(before, product));
    return product;
};

const softDeleteProduct = async (id, actor) => {
    const before = snapshot(await productService.getProductByID(id, { includeDeleted: true }));
    const product = await productService.softDeleteProduct(id);
    await writeAudit(actor, "SOFT_DELETE", "product", product.id, diff(before, product));
    return product;
};

const restoreProduct = async (id, actor) => {
    const before = snapshot(await productService.getProductByID(id, { includeDeleted: true }));
    const product = await productService.restoreProduct(id);
    await writeAudit(actor, "RESTORE", "product", product.id, diff(before, product));
    return product;
};
const createAdminAccount = async ({ username, temporaryPassword } = {}, actor) => {
    const normalizedUsername = accountUsername(username);
    if (!normalizedUsername || normalizedUsername.length > 64 || /\s/.test(normalizedUsername)) {
        throw new AdminAccountError("VALIDATION_FAILED", "Username is invalid", 400);
    }

    const passwordHash = await hashPassword(temporaryPassword);
    let account;
    try {
        account = await adminAccountRepository.createAdmin({
            username: normalizedUsername,
            passwordHash
        });
    } catch (error) {
        if (error && error.code === "P2002") {
            throw new AdminAccountError("USERNAME_TAKEN", "Username is already taken", 409);
        }
        throw error;
    }

    await writeAudit(actor, "CREATE_ADMIN", "user", account.id, {
        username: { old: undefined, new: account.username },
        role: { old: undefined, new: account.role },
        forcePasswordChange: { old: undefined, new: true }
    });
    return account;
};

const getAuditLogs = async () => await auditRepository.getAllLogs();


module.exports = {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    softDeleteProduct,
    restoreProduct,
    createAdminAccount,
    getAuditLogs,
    getAdminProducts: getProducts,
    getProductById: getProduct,
    getProductByID: getProduct,
    deleteProduct: softDeleteProduct,
    restore: restoreProduct,
    getAllAuditLogs: getAuditLogs
};
