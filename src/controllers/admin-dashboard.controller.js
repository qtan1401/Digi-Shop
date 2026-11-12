// ===== ADMIN DASHBOARD CONTROLLER =====

const dashboardService = require("../services/admin-dashboard.service");
const { adminExtrasEnabled } = require("../auth/config");

const sendError = (res, error) => {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error("Admin dashboard request failed:", error?.message || error);
    return res.status(status).json({
        success: false,
        error: {
            code: error?.code || "DASHBOARD_REQUEST_FAILED",
            message: status >= 500 ? "Không thể tải số liệu" : error.message
        }
    });
};

/** [GET] /api/admin/dashboard/summary */
const summary = async (_req, res) => {
    try {
        return res.json({ success: true, data: await dashboardService.getSummary() });
    } catch (error) {
        return sendError(res, error);
    }
};

/** [GET] /api/admin/dashboard/series?granularity=&from=&to= */
const series = async (req, res) => {
    try {
        return res.json({ success: true, data: await dashboardService.getSeries(req.query) });
    } catch (error) {
        return sendError(res, error);
    }
};

/** [GET] /api/admin/features — which optional admin areas the shell may show. */
const features = (_req, res) => res.json({ success: true, data: { extras: adminExtrasEnabled() } });

module.exports = { summary, series, features };
