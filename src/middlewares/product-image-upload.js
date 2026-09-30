const multer = require("multer");
const { PNG } = require("pngjs");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DECODED_PIXELS = 16_777_216;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const hasCompletePngChunks = (buffer) => {
    let offset = PNG_SIGNATURE.length;
    while (offset + 12 <= buffer.length) {
        const chunkLength = buffer.readUInt32BE(offset);
        const chunkEnd = offset + chunkLength + 12;
        if (chunkEnd > buffer.length) return false;
        if (buffer.toString("ascii", offset + 4, offset + 8) === "IEND") {
            return chunkLength === 0 && chunkEnd === buffer.length;
        }
        offset = chunkEnd;
    }
    return false;
};

const hasValidPngContent = (buffer) => {
    if (buffer.length < 24 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
    if (!hasCompletePngChunks(buffer)) return false;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height || width * height > MAX_DECODED_PIXELS) return false;
    try {
        PNG.sync.read(buffer);
        return true;
    } catch {
        return false;
    }
};

const imageError = (res, message) => res.status(400).json({
    success: false,
    message,
    errors: [{ field: "image", message }]
});

const parser = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 16, parts: 17 },
    fileFilter: (_req, file, callback) => {
        if (typeof file.originalname !== "string" || !/\.png$/i.test(file.originalname) || file.mimetype !== "image/png") {
            const error = new Error("Ảnh sản phẩm phải là tệp PNG hợp lệ");
            error.code = "INVALID_PRODUCT_IMAGE";
            return callback(error);
        }
        return callback(null, true);
    }
}).single("image");

const uploadProductImage = (req, res, next) => {
    parser(req, res, (error) => {
        if (!error) {
            if (req.file && !hasValidPngContent(req.file.buffer)) {
                return imageError(res, "Tệp ảnh PNG không hợp lệ hoặc vượt quá giới hạn kích thước giải mã");
            }
            return next();
        }
        if (error.code === "LIMIT_FILE_SIZE") return imageError(res, "Ảnh sản phẩm không được vượt quá 5 MiB");
        if (error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "INVALID_PRODUCT_IMAGE") {
            return imageError(res, error.message || "Chỉ được tải lên một ảnh PNG");
        }
        return imageError(res, "Dữ liệu tải ảnh không hợp lệ");
    });
};

module.exports = { uploadProductImage, MAX_IMAGE_BYTES };
