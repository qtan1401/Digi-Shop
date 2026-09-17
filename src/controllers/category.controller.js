// ===== CATEGORY CONTROLLER =====
// Coordinates public category reads and admin category mutations.

const categoryService = require("../services/category.service");
const adminService = require("../services/admin.service");
const productRepository = require("../repositories/product.repository");

const errorStatus = (error) => {
    if (error && Number.isInteger(error.statusCode)) return error.statusCode;
    if (error && /Không tìm thấy danh mục/.test(error.message || "")) return 404;
    return 400;
};

const sendError = (res, error) => {
    const body = { success: false, message: error.message || "Yêu cầu không hợp lệ" };
    if (Array.isArray(error.errors) && error.errors.length > 0) body.errors = error.errors;
    return res.status(errorStatus(error)).json(body);
};

const getAll = (req, res) => {
    const categories = categoryService.getAllCategories().map((category) => ({
        ...category,
        productCount: productRepository.getAllProducts().reduce((count, product) =>
            product && product.isDeleted === false && String(product.categoryId) === String(category.id)
                ? count + 1
                : count, 0)
    }));
    return res.json({ success: true, data: categories });
};

const create = (req, res) => {
    try {
        const category = adminService.createCategory(req.body || {}, req.user && req.user.role);
        return res.status(201).json({
            success: true,
            message: "Thêm danh mục thành công",
            data: category
        });
    } catch (error) {
        return sendError(res, error);
    }
};

const remove = (req, res) => {
    try {
        adminService.deleteCategory(req.params.id, req.user && req.user.role);
        return res.json({ success: true, message: "Xóa danh mục thành công" });
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
    getAll,
    create,
    remove,
    delete: remove,
    getAllCategories: getAll,
    createCategory: create,
    deleteCategory: remove
};
