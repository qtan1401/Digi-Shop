// ===== ADMIN USER CONTROLLER =====
// HTTP orchestration for customer management (list, rename, ban / unban).

const adminUserService = require("../services/admin-user.service");

const sendError = (res, error) => {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error("Admin user request failed:", error?.message || error);
    return res.status(status).json({
        success: false,
        error: {
            code: error?.code || "ADMIN_USER_REQUEST_FAILED",
            message: status >= 500 ? "Không thể xử lý yêu cầu" : error.message
        }
    });
};

/** [GET] /api/admin/users */
const list = async (req, res) => {
    try {
        const { data, meta } = await adminUserService.listUsers(req.query);
        return res.json({ success: true, data, meta });
    } catch (error) {
        return sendError(res, error);
    }
};

/** [PATCH] /api/admin/users/:id  body { fullName?, status? } */
const update = async (req, res) => {
    try {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const data = await adminUserService.updateUser(req.params.id, { fullName: body.fullName, status: body.status }, req.user);
        return res.json({ success: true, data });
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = { list, update };
