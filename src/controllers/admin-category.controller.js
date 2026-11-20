// HTTP boundary for administrator-managed Categories and Tags.
const categoryService = require("../services/category.service");
const tagService = require("../services/tag.service");
const auditRepository = require("../repositories/audit.repository");

const sendError = (res, error) => {
    if (error instanceof categoryService.CategoryError || error instanceof tagService.TagError) {
        const body = { code: error.code, message: error.message };
        if (error.details) body.details = error.details;
        return res.status(error.statusCode).json({ success: false, error: body });
    }
    return res.status(500).json({
        success: false,
        error: { code: "TAXONOMY_REQUEST_FAILED", message: "Không thể xử lý yêu cầu danh mục hoặc thẻ." }
    });
};

const auditChanges = (previous, current) => {
    const changes = {};
    for (const key of ["slug", "name", "sortOrder", "isDeleted"]) {
        if (previous[key] !== current[key]) changes[key] = { old: previous[key], new: current[key] };
    }
    return changes;
};

const makeHandlers = ({ list, get, create, update, remove, entity, label }) => ({
    list: async (req, res) => {
        try {
            return res.json({ success: true, data: await list() });
        } catch (error) {
            return sendError(res, error);
        }
    },
    create: async (req, res) => {
        try {
            const item = await create(req.body);
            await auditRepository.createLog({
                actor: req.user.id, action: "CREATE", entity, entityId: item.id,
                changes: { new: item }
            });
            return res.status(201).json({ success: true, message: `Đã tạo ${label}.`, data: item });
        } catch (error) {
            return sendError(res, error);
        }
    },
    update: async (req, res) => {
        try {
            const previous = await get(req.params.id);
            const item = await update(req.params.id, req.body);
            await auditRepository.createLog({
                actor: req.user.id, action: "UPDATE", entity, entityId: item.id,
                changes: auditChanges(previous, item)
            });
            return res.json({ success: true, message: `Đã cập nhật ${label}.`, data: item });
        } catch (error) {
            return sendError(res, error);
        }
    },
    remove: async (req, res) => {
        try {
            const previous = await get(req.params.id);
            const item = await remove(req.params.id);
            await auditRepository.createLog({
                actor: req.user.id, action: "DELETE", entity, entityId: item.id,
                changes: auditChanges(previous, item)
            });
            return res.json({ success: true, message: `Đã xóa ${label}.`, data: item });
        } catch (error) {
            return sendError(res, error);
        }
    }
});

const categories = makeHandlers({
    list: categoryService.listAdminCategories,
    get: categoryService.getCategory,
    create: categoryService.createCategory,
    update: categoryService.updateCategory,
    remove: categoryService.softDeleteCategory,
    entity: "category",
    label: "danh mục"
});

const tags = makeHandlers({
    list: tagService.listAdminTags,
    get: tagService.getTag,
    create: tagService.createTag,
    update: tagService.updateTag,
    remove: tagService.softDeleteTag,
    entity: "tag",
    label: "thẻ"
});

module.exports = { categories, tags };
