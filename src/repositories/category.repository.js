// ===== CATEGORY REPOSITORY =====
// Tầng duy nhất được phép đọc/ghi trực tiếp vào categories[].
// Repository chỉ truy xuất dữ liệu, không chứa validation nghiệp vụ.

const categories = require("../models/category.model");
let nextCategoryId = categories.reduce((maxId, category) => Math.max(maxId, Number(category.id) || 0), 0) + 1;


const getAllCategories = () => categories;

const getCategoryById = (id) => categories.find((category) => category.id == id);

const getCategoryBySlug = (slug) => categories.find((category) => category.slug === slug);

const createCategory = (categoryData = {}) => {
    const category = {
        ...categoryData,
        id: nextCategoryId++,
        createdAt: categoryData.createdAt || new Date().toISOString()
    };

    categories.push(category);
    return category;
};

const deleteCategory = (id) => {
    const index = categories.findIndex((category) => category.id == id);
    if (index === -1) return null;

    const [deletedCategory] = categories.splice(index, 1);
    return deletedCategory;
};

module.exports = {
    getAllCategories,
    getCategoryById,
    getCategoryBySlug,
    createCategory,
    deleteCategory,
    // Names used by the G3 repository outline and by integrations that use
    // the shorter lookup convention.
    getById: getCategoryById,
    getBySlug: getCategoryBySlug,
    findById: getCategoryById,
    findBySlug: getCategoryBySlug,
    getAll: getAllCategories,
    create: createCategory,
    getCategoryByID: getCategoryById,
    getByID: getCategoryById,
    delete: deleteCategory
};
