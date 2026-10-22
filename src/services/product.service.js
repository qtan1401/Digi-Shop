// ===== PRODUCT SERVICE =====
// Business logic and invariants for the Product domain.

const productRepository = require("../repositories/product.repository");

const REQUIRED_FIELDS = ["name", "brand", "deviceType", "image", "description"];
const EDITABLE_FIELDS = ["name", "brand", "deviceType", "image", "description"];
const BRANDS = ["Apple", "Samsung", "MSI"];
const DEVICE_TYPES = ["phone", "tablet", "laptop"];
const PRODUCT_STATUSES = ["all", "active", "deleted"];

const createDomainError = (message, errors = [], statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.status = statusCode;
    error.errors = errors;
    return error;
};

const isAllowed = (value, choices) => typeof value === "string" && choices.includes(value);

const normalizeSku = (sku) => typeof sku === "string" ? sku.trim().toUpperCase() : "";

const slugify = (value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isBlank = (value) =>
    value === undefined || value === null ||
    (typeof value === "string" && value.trim().length === 0);

const normalizeOptionText = (value) =>
    typeof value === "string" ? value.trim().normalize("NFC") : "";
const optionKey = (value) => normalizeOptionText(value).toLocaleLowerCase("vi");
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const normalizeColorHex = (rawValue, name, errors) => {
    if (rawValue === undefined || rawValue === null || rawValue === "") return null;
    if (typeof rawValue !== "string" || !HEX_COLOR_PATTERN.test(rawValue)) {
        errors.push({ field: "options", message: `Mã màu của "${name}" phải theo định dạng #RRGGBB.` });
        return null;
    }
    return rawValue.toUpperCase();
};

const normalizeOptions = (rawOptions, errors) => {
    if (!Array.isArray(rawOptions)) {
        errors.push({ field: "options", message: "Tùy chọn phải là danh sách." });
        return [];
    }
    const names = new Set();
    return rawOptions.map((option, optionIndex) => {
        if (!option || typeof option !== "object" || Array.isArray(option)) {
            errors.push({ field: "options", message: "Tùy chọn không hợp lệ." });
            return null;
        }
        const name = normalizeOptionText(option.name);
        const key = optionKey(name);
        if (!name || name.length > 100 || names.has(key)) {
            errors.push({ field: "options", message: "Tên tùy chọn phải có tối đa 100 ký tự và không trùng." });
        }
        names.add(key);
        if (!Array.isArray(option.values) || option.values.length === 0) {
            errors.push({ field: "options", message: `Tùy chọn "${name || optionIndex + 1}" phải có ít nhất một giá trị.` });
            return { name, values: [] };
        }
        const values = new Set();
        const normalizedValues = option.values.map((rawEntry) => {
            const entry = (rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)) ? rawEntry : { value: rawEntry };
            const value = normalizeOptionText(entry.value);
            const valueKey = optionKey(value);
            if (!value || value.length > 100 || values.has(valueKey)) {
                errors.push({ field: "options", message: `Giá trị của "${name}" phải có tối đa 100 ký tự và không trùng.` });
            }
            values.add(valueKey);
            const colorHex = normalizeColorHex(entry.colorHex, name, errors);
            return { value, colorHex };
        });
        return { name, values: normalizedValues };
    }).filter(Boolean);
};

const normalizeVariantOptions = (rawValues, options, field, errors) => {
    if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
        errors.push({ field: "variants", message: `Tổ hợp ${field} thiếu giá trị tùy chọn.` });
        return {};
    }
    const entries = Object.entries(rawValues);
    const mapped = {};
    const consumed = new Set();
    for (const option of options) {
        const key = optionKey(option.name);
        const match = entries.find(([name]) => optionKey(name) === key);
        if (!match) {
            errors.push({ field: "variants", message: `Tổ hợp ${field} thiếu tùy chọn "${option.name}".` });
            continue;
        }
        consumed.add(match[0]);
        const value = normalizeOptionText(match[1]);
        const canonicalValue = option.values.find((candidate) => optionKey(candidate.value) === optionKey(value));
        if (!canonicalValue) {
            errors.push({ field: "variants", message: `Giá trị "${value}" không thuộc tùy chọn "${option.name}".` });
            continue;
        }
        mapped[option.name] = canonicalValue.value;
    }
    if (entries.some(([name]) => !consumed.has(name))) {
        errors.push({ field: "variants", message: `Tổ hợp ${field} có tùy chọn không được khai báo.` });
    }
    return mapped;
};

const sameOptionValues = (left = {}, right = {}) => {
    const canonical = (values) => Object.entries(values)
        .map(([name, value]) => [optionKey(name), optionKey(value)])
        .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};

/**
 * Validate the Product's shared fields and its complete sellable variant set.
 * @param {Object} input
 * @returns {Object}
 */
const validateProduct = (input) => {
    const data = { ...input };
    const errors = [];

    for (const field of REQUIRED_FIELDS) {
        if (isBlank(data[field])) errors.push({ field, message: `${field} là trường bắt buộc` });
    }

    if (typeof data.name === "string") {
        data.name = data.name.trim();
        if (data.name.length < 2 || data.name.length > 200) {
            errors.push({ field: "name", message: "Tên sản phẩm phải từ 2 đến 200 ký tự" });
        }
    } else if (!isBlank(data.name)) {
        errors.push({ field: "name", message: "Tên sản phẩm phải là chuỗi" });
    }

    if (!isAllowed(data.brand, BRANDS)) {
        errors.push({ field: "brand", message: "Thương hiệu phải là Apple, Samsung hoặc MSI" });
    }
    if (!isAllowed(data.deviceType, DEVICE_TYPES)) {
        errors.push({ field: "deviceType", message: "Loại thiết bị phải là phone, tablet hoặc laptop" });
    }

    if (typeof data.image !== "string" || isBlank(data.image)) {
        if (!errors.some((error) => error.field === "image")) {
            errors.push({ field: "image", message: "Ảnh sản phẩm là trường bắt buộc" });
        }
    } else {
        data.image = data.image.trim();
    }

    if (typeof data.description !== "string" || isBlank(data.description)) {
        if (!errors.some((error) => error.field === "description")) {
            errors.push({ field: "description", message: "Mô tả sản phẩm là trường bắt buộc" });
        }
    } else {
        data.description = data.description.trim();
    }

    const options = normalizeOptions(data.options === undefined ? [] : data.options, errors);
    const variants = data.variants;
    if (!Array.isArray(variants) || variants.length === 0) {
        errors.push({ field: "variants", message: "Sản phẩm phải có ít nhất một biến thể bán được." });
    }

    const variantSkus = new Set();
    const combinations = new Set();
    const usedValues = new Map(options.map((option) => [option.name, new Set()]));
    const normalizedVariants = Array.isArray(variants) ? variants.map((variant, index) => {
        const field = `#${index + 1}`;
        if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
            errors.push({ field: "variants", message: `Biến thể ${field} không hợp lệ.` });
            return null;
        }
        const sku = normalizeSku(variant.sku);
        if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(sku)) {
            errors.push({ field: "variants", message: `SKU của biến thể ${field} chỉ được chứa chữ cái, số và dấu gạch nối.` });
        }
        if (variantSkus.has(sku)) errors.push({ field: "variants", message: `SKU "${sku}" bị lặp trong danh sách biến thể.` });
        variantSkus.add(sku);

        const price = Number(variant.price);
        const stock = Number(variant.stock);
        if (!Number.isFinite(price) || !Number.isInteger(price) || price <= 0) {
            errors.push({ field: "variants", message: `Giá của biến thể ${field} phải là số nguyên dương.` });
        }
        if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
            errors.push({ field: "variants", message: `Tồn kho của biến thể ${field} phải là số nguyên không âm.` });
        }

        const optionValues = normalizeVariantOptions(variant.optionValues ?? variant.options, options, field, errors);
        const combination = JSON.stringify(Object.entries(optionValues)
            .map(([name, value]) => [optionKey(name), optionKey(value)])
            .sort(([leftName], [rightName]) => leftName.localeCompare(rightName)));
        if (combinations.has(combination)) {
            errors.push({ field: "variants", message: `Tổ hợp thuộc tính của biến thể ${field} bị trùng.` });
        }
        combinations.add(combination);
        for (const [name, value] of Object.entries(optionValues)) usedValues.get(name)?.add(optionKey(value));
        return { sku, price, stock, image: typeof variant.image === "string" && variant.image.trim() ? variant.image.trim() : null, optionValues };
    }).filter(Boolean) : [];

    for (const option of options) {
        const used = usedValues.get(option.name);
        if (option.values.some((value) => !used?.has(optionKey(value.value)))) {
            errors.push({ field: "options", message: `Mọi giá trị của "${option.name}" phải xuất hiện trong ít nhất một biến thể.` });
        }
    }

    if (errors.length > 0) {
        throw createDomainError(
            "Vui lòng nhập đầy đủ và chính xác thông tin sản phẩm và biến thể.",
            errors
        );
    }

    data.options = options;
    data.variants = normalizedVariants;
    return data;
};

const assertUniqueSkus = async (variants, productId, currentProduct) => {
    for (const variant of variants) {
        const existing = await productRepository.findBySku(variant.sku);
        if (!existing) continue;
        const sameCurrentVariant = currentProduct?.variants?.some((current) =>
            current.id === existing.id &&
            sameOptionValues(current.optionValues, variant.optionValues)
        );
        if (!sameCurrentVariant) {
            throw createDomainError(
                `Mã SKU "${variant.sku}" đã tồn tại trên hệ thống. SKU là duy nhất vĩnh viễn.`,
                [{ field: "variants", message: `SKU "${variant.sku}" bị trùng.` }]
            );
        }
    }
};

/**
 * Public list. Deleted records are excluded by default.
 * Set includeDeleted/status explicitly for an internal/admin caller.
 */
const getAllProducts = async (options = {}) => {
    if (options === true || options.includeDeleted === true || options.status === "all") {
        return await productRepository.findWithFilter("", "all");
    }
    if (options.status === "deleted") {
        return await productRepository.findWithFilter("", "deleted");
    }
    return await productRepository.findWithFilter("", "active");
};

/**
 * Public detail lookup excludes soft-deleted products by default.
 */
const getProductByID = async (id, options = {}) => {
    const product = await productRepository.getProductByID(id);
    if (!product || (product.isDeleted === true && options.includeDeleted !== true)) {
        throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    }
    return product;
};

const getProductById = getProductByID;
const getAdminProductById = async (id) =>
    await getProductByID(id, { includeDeleted: true });

const findProducts = async (filters = {}) => {
    const status = filters.status || "active";
    if (!PRODUCT_STATUSES.includes(status)) {
        throw createDomainError("Trạng thái sản phẩm không hợp lệ.", [
            { field: "status", message: "status phải là all, active hoặc deleted" }
        ]);
    }
    return await productRepository.findWithFilter(filters.q, status);
};

const getAdminProducts = async (filters = {}) => {
    const data = await findProducts(filters);
    return { data, total: data.length };
};

const createProduct = async (input) => {
    const data = validateProduct(input);
    await assertUniqueSkus(data.variants);
    const timestamp = new Date().toISOString();
    return await productRepository.createProduct({
        ...data,
        slug: slugify(data.name),
        isDeleted: false,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
    });
};

const updateProduct = async (id, input = {}) => {
    const product = await productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);

    const changes = {};
    for (const field of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(input, field)) changes[field] = input[field];
    }
    for (const field of ["options", "variants"]) {
        if (Object.prototype.hasOwnProperty.call(input, field)) changes[field] = input[field];
    }

    const merged = validateProduct({ ...product, ...changes });
    await assertUniqueSkus(merged.variants, product.id, product);

    delete merged.id;
    delete merged.slug;
    delete merged.isDeleted;
    delete merged.deletedAt;
    delete merged.createdAt;
    return await productRepository.updateProduct(product.id, merged);
};

const softDeleteProduct = async (id) => {
    const product = await productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    if (product.isDeleted === true) {
        throw createDomainError("Sản phẩm đã nằm trong thùng rác.");
    }
    return await productRepository.softDelete(id);
};

const deleteProduct = softDeleteProduct;

const restoreProduct = async (id) => {
    const product = await productRepository.getProductByID(id);
    if (!product) throw createDomainError("Không tìm thấy sản phẩm", [], 404);
    if (product.isDeleted !== true) {
        throw createDomainError("Sản phẩm hiện không ở trạng thái đã xóa.");
    }
    return await productRepository.restoreProduct(id);
};

const restore = restoreProduct;

module.exports = {
    REQUIRED_FIELDS,
    BRANDS,
    DEVICE_TYPES,
    PRODUCT_STATUSES,
    normalizeSku,
    getAllProducts,
    getProductByID,
    getProductById,
    getAdminProductById,
    findProducts,
    getAdminProducts,
    createProduct,
    updateProduct,
    softDeleteProduct,
    deleteProduct,
    restoreProduct,
    restore
};
