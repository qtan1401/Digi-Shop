// Gate for admin features outside the course brief. Off by default (ADMIN_EXTRAS), then the route answers 404
// as if it did not exist. Mount it after the role check so anonymous callers still get 401/403.

const { adminExtrasEnabled } = require("../auth/config");

const requireAdminExtras = (req, res, next) => {
    if (adminExtrasEnabled()) return next();
    return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Không tìm thấy" } });
};

module.exports = { requireAdminExtras };
