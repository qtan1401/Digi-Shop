// ===== ADMIN VOUCHER CONTROLLER =====
// HTTP orchestration for administrator Voucher CRUD (mounted under the admin router).

const voucherService = require("../services/voucher.service");

const actor = (req) => req.user && req.user.id;

const sendError = (res, error) => {
    const known = Number.isInteger(error?.statusCode) && error.code;
    if (!known) {
        return res.status(500).json({
            success: false,
            error: { code: "VOUCHER_REQUEST_FAILED", message: "Không thể xử lý yêu cầu voucher." }
        });
    }
    const body = { code: error.code, message: error.message };
    if (Array.isArray(error.details)) body.details = error.details;
    return res.status(error.statusCode).json({ success: false, error: body });
};

const list = async (req, res) => {
    try {
        const result = await voucherService.listVouchers({
            q: req.query.q,
            status: req.query.status || "all",
            page: req.query.page,
            pageSize: req.query.pageSize
        });
        return res.json({ success: true, data: result.data, meta: result.meta });
    } catch (error) {
        return sendError(res, error);
    }
};

const get = async (req, res) => {
    try {
        return res.json({ success: true, data: await voucherService.getVoucher(req.params.id) });
    } catch (error) {
        return sendError(res, error);
    }
};

const create = async (req, res) => {
    try {
        const voucher = await voucherService.createVoucher(req.body, actor(req));
        return res.status(201).json({ success: true, message: "Đã tạo voucher.", data: voucher });
    } catch (error) {
        return sendError(res, error);
    }
};

const update = async (req, res) => {
    try {
        const voucher = await voucherService.updateVoucher(req.params.id, req.body, actor(req));
        return res.json({ success: true, message: "Đã cập nhật voucher.", data: voucher });
    } catch (error) {
        return sendError(res, error);
    }
};

const remove = async (req, res) => {
    try {
        await voucherService.deleteVoucher(req.params.id, actor(req));
        return res.json({ success: true, message: "Đã xóa voucher." });
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = { list, get, create, update, remove };
