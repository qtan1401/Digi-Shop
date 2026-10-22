// ===== ADMIN CONTROLLER =====
// HTTP orchestration for the protected catalog administration boundary.

const adminService = require("../services/admin.service");
const productImageStorage = require("../services/product-image-storage");

const COLOR_OPTION_NAME = "màu sắc";
const isColorOption = (name) => typeof name === "string" && name.trim().toLocaleLowerCase("vi") === COLOR_OPTION_NAME;
const optionValueText = (entry) =>
    typeof entry === "string" ? entry.trim() : String(entry?.value ?? "").trim();

const productMutationInput = (req) => {
    const input = { ...(req.body || {}) };
    for (const field of ["options", "variants"]) {
        if (typeof input[field] !== "string") continue;
        try {
            input[field] = JSON.parse(input[field]);
        } catch {
            const error = new Error(`Trường ${field} không đúng định dạng JSON.`);
            error.statusCode = 400;
            error.errors = [{ field, message: "Dữ liệu tùy chọn/biến thể không hợp lệ." }];
            throw error;
        }
    }
    return input;
};

const missingImageError = (hasColorOption) => ({
    statusCode: 400,
    message: "Ảnh sản phẩm là trường bắt buộc",
    errors: [hasColorOption
        ? { field: "colorImages", message: "Mỗi màu cần có một ảnh PNG hoặc WebP." }
        : { field: "image", message: "Ảnh sản phẩm là trường bắt buộc" }]
});

/**
 * Resolve the image each variant should persist.
 * Variants are grouped by their color value (if the product has a "Màu sắc" option);
 * every variant sharing a color inherits that color's uploaded or carried-over image,
 * and the first color's image becomes the product's catalog-grid cover image.
 * Products without a color option fall back to the single cover-image upload.
 */
const resolveVariantImages = async (input, req, previousProduct) => {
    const colorOption = Array.isArray(input.options) ? input.options.find((option) => isColorOption(option?.name)) : null;
    const previousImageByColor = new Map();
    for (const variant of previousProduct?.variants || []) {
        const colorValue = variant.optionValues?.[colorOption?.name];
        if (colorValue !== undefined) previousImageByColor.set(String(colorValue).trim(), variant.image || null);
    }

    const savedFiles = [];
    const newImageByColor = new Map();
    try {
        if (colorOption) {
            for (const { value, file } of req.colorImageFiles || []) {
                const stored = await productImageStorage.saveProductImage(file);
                savedFiles.push(stored);
                newImageByColor.set(String(value).trim(), stored.publicPath);
            }
        }
        if (colorOption) {
            const missingColors = (Array.isArray(colorOption.values) ? colorOption.values : [])
                .map(optionValueText)
                .filter((value) => !newImageByColor.has(value) && !previousImageByColor.get(value));
            if (missingColors.length > 0) {
                const error = new Error(`Cần tải ảnh cho các màu: ${missingColors.join(", ")}.`);
                error.statusCode = 400;
                error.errors = [{ field: "colorImages", message: error.message }];
                throw error;
            }
        }

        let coverImage = null;
        if (colorOption) {
            const firstColorValue = optionValueText(colorOption.values?.[0]);
            coverImage = newImageByColor.get(firstColorValue) ?? previousImageByColor.get(firstColorValue) ?? null;
        } else if (req.file) {
            const stored = await productImageStorage.saveProductImage(req.file);
            savedFiles.push(stored);
            coverImage = stored.publicPath;
        } else if (previousProduct) {
            coverImage = previousProduct.image;
        }

        const variants = Array.isArray(input.variants) ? input.variants.map((variant) => {
            if (!colorOption) return variant;
            const colorValue = String((variant.optionValues ?? variant.options)?.[colorOption.name] ?? "").trim();
            const image = newImageByColor.get(colorValue) ?? previousImageByColor.get(colorValue) ?? null;
            return { ...variant, image };
        }) : input.variants;

        return { variants, coverImage, savedFiles };
    } catch (error) {
        for (const stored of savedFiles) await productImageStorage.removeProductImage(stored).catch(() => undefined);
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
        const input = productMutationInput(req);
        const hasColorOption = Array.isArray(input.options) && input.options.some((option) => isColorOption(option?.name));
        const { variants, coverImage, savedFiles } = await resolveVariantImages(input, req, null);
        try {
            if (!coverImage) throw missingImageError(hasColorOption);
            const product = await adminService.createProduct({ ...input, variants, image: coverImage }, actor(req));
            return res.status(201).json({
                success: true,
                message: "Thêm sản phẩm thành công",
                data: product
            });
        } catch (error) {
            for (const stored of savedFiles) await productImageStorage.removeProductImage(stored).catch(() => undefined);
            throw error;
        }
    } catch (error) {
        return sendError(res, error);
    }
};

const updateProduct = async (req, res) => {
    try {
        const input = productMutationInput(req);
        const touchesConfiguration = Object.prototype.hasOwnProperty.call(input, "variants")
            || Object.prototype.hasOwnProperty.call(input, "options")
            || Boolean(req.file)
            || Boolean(req.colorImageFiles && req.colorImageFiles.length);
        if (!touchesConfiguration) {
            const product = await adminService.updateProduct(req.params.id, input, actor(req));
            return res.json({ success: true, message: "Cập nhật sản phẩm thành công", data: product });
        }
        const previousProduct = await adminService.getProduct(req.params.id);
        const hasColorOption = Array.isArray(input.options) && input.options.some((option) => isColorOption(option?.name));
        const { variants, coverImage, savedFiles } = await resolveVariantImages(input, req, previousProduct);
        try {
            if (!coverImage) throw missingImageError(hasColorOption);
            const product = await adminService.updateProduct(req.params.id, { ...input, variants, image: coverImage }, actor(req));
            return res.json({
                success: true,
                message: "Cập nhật sản phẩm thành công",
                data: product
            });
        } catch (error) {
            for (const stored of savedFiles) await productImageStorage.removeProductImage(stored).catch(() => undefined);
            throw error;
        }
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
