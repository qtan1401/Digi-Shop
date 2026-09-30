// ===== ADMIN CONTROLLER =====
// HTTP orchestration for the protected catalog administration boundary.

const adminService = require("../services/admin.service");
const productImageStorage = require("../services/product-image-storage");

const productMutationInput = (req) => {
    const input = { ...(req.body || {}) };
    if (req.file) input.image = req.file;
    if (req.is("multipart/form-data")) {
        for (const field of ["price", "stock"]) {
            if (input[field] !== undefined && input[field] !== "") input[field] = Number(input[field]);
        }
    }
    return input;
};


const missingProductImage = () => ({
    statusCode: 400,
    message: "Ảnh sản phẩm là trường bắt buộc",
    errors: [{ field: "image", message: "Ảnh sản phẩm là trường bắt buộc" }]
});

const updateInput = (req) => {
    const input = productMutationInput(req);
    if (!req.file) delete input.image;
    return input;
};

const createWithImage = async (req, operation) => {
    if (!req.file) throw missingProductImage();
    return await withStoredImage(req, operation);
};
const withStoredImage = async (req, operation) => {
    if (!req.file) return await operation(productMutationInput(req));
    const stored = await productImageStorage.saveProductImage(req.file);
    try {
        return await operation({ ...productMutationInput(req), image: stored.publicPath });
    } catch (error) {
        await productImageStorage.removeProductImage(stored);
        throw error;
    }
};

const errorStatus = (error) => {
    if (error && Number.isInteger(error.statusCode)) return error.statusCode;
    if (error && /Không tìm thấy sản phẩm/.test(error.message || "")) return 404;
    return 400;
};

const sendError = (res, error) => {
    const message = error.message || "Yêu cầu không hợp lệ";
    const body = { success: false, message };
    if (error && error.code) body.error = { code: error.code, message };
    if (Array.isArray(error.errors) && error.errors.length > 0) body.errors = error.errors;
    return res.status(errorStatus(error)).json(body);
};

const actor = (req) => req.user && req.user.id;

const createAccount = async (req, res) => {
    try {
        const account = await adminService.createAdminAccount(req.body || {}, actor(req));
        return res.status(201).json({
            success: true,
            data: {
                id: account.id,
                username: account.username,
                role: account.role,
                forcePasswordChange: true
            }
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const listProducts = async (req, res) => {
    try {
        const result = await adminService.getProducts({
            q: req.query.q,
            status: req.query.status || "active"
        });
        return res.json({
            success: true,
            total: result.total,
            data: result.data
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const getProduct = async (req, res) => {
    try {
        const product = await adminService.getProduct(req.params.id);
        return res.json({ success: true, data: product });
    } catch (error) {
        return sendError(res, error);
    }
};

const createProduct = async (req, res) => {
    try {
        const product = await createWithImage(req, (input) => adminService.createProduct(input, actor(req)));
        return res.status(201).json({
            success: true,
            message: "Thêm sản phẩm thành công",
            data: product
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const updateProduct = async (req, res) => {
    try {
        const product = req.file
            ? await withStoredImage(req, (input) => adminService.updateProduct(req.params.id, input, actor(req)))
            : await adminService.updateProduct(req.params.id, updateInput(req), actor(req));
        return res.json({
            success: true,
            message: "Cập nhật sản phẩm thành công",
            data: product
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const deleteProduct = async (req, res) => {
    try {
        await adminService.softDeleteProduct(req.params.id, actor(req));
        return res.json({
            success: true,
            message: "Đã xóa mềm sản phẩm thành công. Sản phẩm đã được chuyển vào thùng rác."
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const restoreProduct = async (req, res) => {
    try {
        const id = req.params.id !== undefined
            ? req.params.id
            : (req.body && (req.body.productId !== undefined ? req.body.productId : req.body.id));
        await adminService.restoreProduct(id, actor(req));
        return res.json({
            success: true,
            message: "Khôi phục sản phẩm thành công. Sản phẩm đã hiển thị lại trên website."
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const listAuditLogs = async (req, res) => {
    try {
        const data = await adminService.getAuditLogs();
        return res.json({ success: true, total: data.length, data });
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
    createAccount,
    listProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    restoreProduct,
    listAuditLogs,
    getAllProducts: listProducts,
    getProductById: getProduct,
    softDeleteProduct: deleteProduct,
    getAuditLogs: listAuditLogs,
    getAll: listProducts,
    getById: getProduct,
    create: createProduct,
    update: updateProduct,
    remove: deleteProduct,
    restore: restoreProduct
};
