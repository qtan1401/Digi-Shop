// ===== ADMIN CONTROLLER =====
// HTTP orchestration for the protected catalog administration boundary.

const adminService = require("../services/admin.service");
const categoryService = require("../services/category.service");

const errorStatus = (error) => {
    if (error && Number.isInteger(error.statusCode)) return error.statusCode;
    if (error && /Không tìm thấy (sản phẩm|danh mục)/.test(error.message || "")) return 404;
    return 400;
};

const sendError = (res, error) => {
    const body = { success: false, message: error.message || "Yêu cầu không hợp lệ" };
    if (Array.isArray(error.errors) && error.errors.length > 0) body.errors = error.errors;
    return res.status(errorStatus(error)).json(body);
};

const actor = (req) => req.user && req.user.role;

const withCategoryName = (product) => {
    const category = categoryService.findCategoryById(product.categoryId);
    return { ...product, categoryName: category ? category.name : null };
};

const listProducts = (req, res) => {
    try {
        const result = adminService.getProducts({
            q: req.query.q,
            categoryId: req.query.categoryId,
            status: req.query.status || "active"
        });
        return res.json({
            success: true,
            total: result.total,
            data: result.data.map(withCategoryName)
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const getProduct = (req, res) => {
    try {
        return res.json({ success: true, data: withCategoryName(adminService.getProduct(req.params.id)) });
    } catch (error) {
        return sendError(res, error);
    }
};

const createProduct = (req, res) => {
    try {
        const product = adminService.createProduct(req.body || {}, actor(req));
        return res.status(201).json({
            success: true,
            message: "Thêm sản phẩm thành công",
            data: product
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const updateProduct = (req, res) => {
    try {
        const product = adminService.updateProduct(req.params.id, req.body || {}, actor(req));
        return res.json({
            success: true,
            message: "Cập nhật sản phẩm thành công",
            data: product
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const deleteProduct = (req, res) => {
    try {
        adminService.softDeleteProduct(req.params.id, actor(req));
        return res.json({
            success: true,
            message: "Đã xóa mềm sản phẩm thành công. Sản phẩm đã được chuyển vào thùng rác."
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const restoreProduct = (req, res) => {
    try {
        const options = { ...(req.body || {}) };
        const id = req.params.id !== undefined
            ? req.params.id
            : (options.productId !== undefined ? options.productId : options.id);
        delete options.productId;
        delete options.id;
        adminService.restoreProduct(id, options, actor(req));
        return res.json({
            success: true,
            message: "Khôi phục sản phẩm thành công. Sản phẩm đã hiển thị lại trên website."
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const listAuditLogs = (req, res) => {
    try {
        const data = adminService.getAuditLogs();
        return res.json({ success: true, total: data.length, data });
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
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
