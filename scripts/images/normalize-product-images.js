"use strict";

/*
 * Normalises product photos to the catalog standard: 1200x1200 PNG, pure white (#FFFFFF) background,
 * product centred with ~9% empty margin on every side, file size <= 400KB.
 *
 * Usage:
 *   node scripts/images/normalize-product-images.js <file|dir> [<file|dir> ...] [--out <dir>]
 *
 * - Inputs are local paths only (the script never touches the network). Directories are scanned for
 *   .png/.jpg/.jpeg/.webp files (non-recursive).
 * - Without --out each result is written next to its source as <name>.png (a .png source is overwritten).
 * - With --out <dir> results are written there and the sources stay untouched.
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const SIZE = 1200;
const MARGIN_RATIO = 0.09;
const MAX_BYTES = 400 * 1024;
const TRIM_THRESHOLD = 12;
const EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const INNER = Math.round(SIZE * (1 - 2 * MARGIN_RATIO));

function parseArguments(argv) {
    const inputs = [];
    let outDir = null;
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === "--out") {
            outDir = argv[index + 1];
            index += 1;
            if (!outDir) throw new Error("--out needs a directory.");
        } else {
            inputs.push(argv[index]);
        }
    }
    if (inputs.length === 0) throw new Error("Usage: normalize-product-images.js <file|dir> [...] [--out <dir>]");
    return { inputs, outDir };
}

function collectFiles(inputs) {
    const files = [];
    for (const input of inputs) {
        const stat = fs.statSync(input);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(input).sort()) {
                if (EXTENSIONS.has(path.extname(name).toLowerCase())) files.push(path.join(input, name));
            }
        } else {
            files.push(input);
        }
    }
    return files;
}

async function encode(canvas) {
    let buffer = await canvas.png({ compressionLevel: 9, effort: 10 }).toBuffer();
    for (const quality of [100, 90, 80, 70, 60, 50]) {
        if (buffer.length <= MAX_BYTES) break;
        buffer = await sharp(buffer).png({ palette: true, quality, colours: 256, effort: 10, compressionLevel: 9 }).toBuffer();
    }
    if (buffer.length > MAX_BYTES) throw new Error(`cannot compress below ${MAX_BYTES} bytes (${buffer.length}).`);
    return buffer;
}

async function normalize(source) {
    // Flatten any transparency onto white first so trim only ever sees one background colour.
    const flattened = await sharp(source).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
    const trimmed = await sharp(flattened).trim({ background: "#ffffff", threshold: TRIM_THRESHOLD }).toBuffer();
    const product = await sharp(trimmed)
        .resize(INNER, INNER, { fit: "inside", kernel: "lanczos3" })
        .toBuffer({ resolveWithObject: true });
    const left = Math.round((SIZE - product.info.width) / 2);
    const top = Math.round((SIZE - product.info.height) / 2);
    const canvas = sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } })
        .composite([{ input: product.data, left, top }]);
    return encode(canvas);
}

async function main() {
    const { inputs, outDir } = parseArguments(process.argv.slice(2));
    if (outDir) fs.mkdirSync(outDir, { recursive: true });
    for (const file of collectFiles(inputs)) {
        const target = path.join(outDir || path.dirname(file), `${path.basename(file, path.extname(file))}.png`);
        const buffer = await normalize(file);
        fs.writeFileSync(target, buffer);
        console.log(`${path.basename(target)}: ${SIZE}x${SIZE}, ${Math.round(buffer.length / 1024)}KB`);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
