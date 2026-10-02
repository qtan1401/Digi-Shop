const multer = require("multer");
const { PNG } = require("pngjs");
const sharp = require("sharp");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_DECODED_PIXELS = 25_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const INVALID_IMAGE_MESSAGE = "Ảnh bị hỏng hoặc không đúng định dạng.";
const IMAGE_DIMENSION_ERROR = "Ảnh vượt giới hạn độ phân giải (tối đa 8.192 px mỗi cạnh và 25 MP).";
const WEBP_SIGNATURE = Buffer.from("RIFF");
const WEBP_FORMAT_SIGNATURE = Buffer.from("WEBP");
const ANIMATED_WEBP_MESSAGE = "Ảnh WebP động không được hỗ trợ.";

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

const exceedsResolutionLimit = (width, height) =>
    width > MAX_IMAGE_DIMENSION
    || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_DECODED_PIXELS;

const getPngContentError = (buffer) => {
    if (
        buffer.length < 33
        || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        || buffer.readUInt32BE(8) !== 13
        || buffer.toString("ascii", 12, 16) !== "IHDR"
        || !hasCompletePngChunks(buffer)
    ) return INVALID_IMAGE_MESSAGE;

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) return INVALID_IMAGE_MESSAGE;
    if (exceedsResolutionLimit(width, height)) return IMAGE_DIMENSION_ERROR;

    try {
        PNG.sync.read(buffer);
        return null;
    } catch {
        return INVALID_IMAGE_MESSAGE;
    }
};

const isWebP = (buffer) =>
    buffer.length >= 12
    && buffer.subarray(0, 4).equals(WEBP_SIGNATURE)
    && buffer.subarray(8, 12).equals(WEBP_FORMAT_SIGNATURE);

const getWebPContentError = async (buffer) => {
    try {
        const metadata = await sharp(buffer, { failOn: "warning" }).metadata();
        if (metadata.format !== "webp" || !metadata.width || !metadata.height) return INVALID_IMAGE_MESSAGE;
        if (exceedsResolutionLimit(metadata.width, metadata.height)) return IMAGE_DIMENSION_ERROR;
        if (metadata.pages > 1) return ANIMATED_WEBP_MESSAGE;
        await sharp(buffer, {
            failOn: "warning",
            limitInputPixels: MAX_DECODED_PIXELS
        }).stats();
        return null;
    } catch {
        return INVALID_IMAGE_MESSAGE;
    }
};

const validateImageContent = async (buffer) => {
    if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        const error = getPngContentError(buffer);
        return { error, format: error ? null : "png" };
    }
    if (isWebP(buffer)) {
        const error = await getWebPContentError(buffer);
        return { error, format: error ? null : "webp" };
    }
    return { error: INVALID_IMAGE_MESSAGE, format: null };
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
        const hasSupportedName = typeof file.originalname === "string" && /\.(png|webp)$/i.test(file.originalname);
        const hasSupportedMimeType = ["image/png", "image/webp"].includes(file.mimetype);
        if (!hasSupportedName || !hasSupportedMimeType) {
            const error = new Error("Ảnh sản phẩm phải là PNG hoặc WebP hợp lệ");
            error.code = "INVALID_PRODUCT_IMAGE";
            return callback(error);
        }
        return callback(null, true);
    }
}).single("image");

const uploadProductImage = (req, res, next) => {
    parser(req, res, async (error) => {
        if (!error) {
            if (req.file) {
                const { error: contentError, format } = await validateImageContent(req.file.buffer);
                if (contentError) return imageError(res, contentError);
                req.file.productImageFormat = format;
            }
            return next();
        }
        if (error.code === "LIMIT_FILE_SIZE") return imageError(res, "Ảnh sản phẩm không được vượt quá 5 MiB");
        if (error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "INVALID_PRODUCT_IMAGE") {
            return imageError(res, error.message || "Chỉ được tải lên một ảnh PNG hoặc WebP");
        }
        return imageError(res, "Dữ liệu tải ảnh không hợp lệ");
    });
};

module.exports = { uploadProductImage, MAX_IMAGE_BYTES };
