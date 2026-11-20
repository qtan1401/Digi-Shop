const path = require("path");

const notFoundPage = path.join(__dirname, "../../public/404.html");

// Unknown API paths answer JSON, browsers get the site's 404 page, anything else a short Vietnamese text.
const sendNotFound = (req, res) => {
    if (req.path.startsWith("/api/") || req.path === "/api") {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên" } });
    }
    if (req.accepts(["html", "json", "text"]) === "html") return res.status(404).sendFile(notFoundPage);
    return res.status(404).type("text/plain").send("Không tìm thấy trang");
};

// Last resort for errors nobody handled: never echo internals (Prisma messages, file paths) to the client.
const handleError = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status === 404) return sendNotFound(req, res);
    if (status >= 400 && status < 500) {
        return res.status(status).json({ success: false, message: "Yêu cầu không hợp lệ" });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "Đã xảy ra lỗi hệ thống, vui lòng thử lại sau." });
};

module.exports = { sendNotFound, handleError };
