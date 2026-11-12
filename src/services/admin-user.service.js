// ===== ADMIN USER SERVICE =====
// Customer management: list, rename, ban / unban. Administrators are never listed or changed here.

const adminUserRepository = require("../repositories/admin-user.repository");
const authRepository = require("../repositories/auth.repository");
const auditRepository = require("../repositories/audit.repository");

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 1000000;

const domainError = (code, statusCode, message) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
};

const parsePositive = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
        throw domainError("INVALID_PAGINATION", 400, "Tham số phân trang không hợp lệ");
    }
    return Number(value);
};

/** Customers, 20 per page by default, searched by email, full name or username. */
const listUsers = async (query = {}) => {
    if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 100)) {
        throw domainError("INVALID_FILTER", 400, "Bộ lọc không hợp lệ");
    }
    const search = query.q === undefined ? undefined : query.q.trim() || undefined;
    const requestedPage = parsePositive(query.page, 1, MAX_PAGE);
    const pageSize = parsePositive(query.pageSize, PAGE_SIZE, MAX_PAGE_SIZE);

    // The total is needed to clamp the page, so the first read may be empty when the page is out of range.
    let result = await adminUserRepository.listCustomers({ search, skip: (requestedPage - 1) * pageSize, take: pageSize });
    const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    if (page !== requestedPage) {
        result = await adminUserRepository.listCustomers({ search, skip: (page - 1) * pageSize, take: pageSize });
    }
    return { data: result.rows, meta: { page, pageSize, total: result.total, totalPages } };
};

const normalizeFullName = (value) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

/**
 * Changes a customer's full name and/or status. `status` takes ACTIVE (unban) or BANNED. A banned account is
 * restored to ACTIVE when its email was verified, otherwise to UNVERIFIED, so unbanning never verifies an email.
 */
const updateUser = async (id, input = {}, actor) => {
    const hasName = input.fullName !== undefined;
    const hasStatus = input.status !== undefined;
    if (!hasName && !hasStatus) throw domainError("VALIDATION_FAILED", 400, "Không có thay đổi nào để lưu");
    if (typeof id !== "string" || !id || id.length > 36) throw domainError("USER_NOT_FOUND", 404, "Không tìm thấy người dùng");

    let fullName;
    if (hasName) {
        fullName = normalizeFullName(input.fullName);
        if (fullName.length < 2 || fullName.length > 200) {
            throw domainError("VALIDATION_FAILED", 400, "Họ và tên phải có 2-200 ký tự");
        }
    }
    if (hasStatus && !["ACTIVE", "BANNED"].includes(input.status)) {
        throw domainError("VALIDATION_FAILED", 400, "Trạng thái chỉ có thể là ACTIVE hoặc BANNED");
    }

    const account = await adminUserRepository.findAccount(id);
    if (!account) throw domainError("USER_NOT_FOUND", 404, "Không tìm thấy người dùng");
    if (account.role !== "user") throw domainError("CANNOT_MODIFY_ADMIN", 403, "Không thể sửa hoặc khóa tài khoản quản trị");

    const actorName = (actor && (actor.username || actor.email || actor.id)) || "admin";
    const changes = {};

    if (hasName && fullName !== account.fullName) {
        await authRepository.updateFullName({ userId: id, fullName });
        changes.fullName = { old: account.fullName, new: fullName };
    }

    if (hasStatus) {
        const target = input.status === "BANNED"
            ? "BANNED"
            : account.status === "BANNED" ? (account.emailVerified ? "ACTIVE" : "UNVERIFIED") : account.status;
        if (input.status === "ACTIVE" && account.status !== "BANNED" && account.status !== "ACTIVE") {
            throw domainError("INVALID_STATUS_TRANSITION", 400, "Chỉ mở khóa được tài khoản đang bị khóa");
        }
        if (target !== account.status) {
            await authRepository.setUserStatus({ userId: id, status: target });
            changes.status = { old: account.status, new: target };
        }
    }

    if (Object.keys(changes).length > 0) {
        const action = changes.status ? (changes.status.new === "BANNED" ? "BAN" : "UNBAN") : "UPDATE";
        await auditRepository.createLog({ actor: actorName, action, entity: "user", entityId: id, changes });
    }
    return await adminUserRepository.findAccount(id);
};

module.exports = { listUsers, updateUser };
