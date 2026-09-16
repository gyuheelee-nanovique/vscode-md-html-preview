"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readImageSize = readImageSize;
const fs = __importStar(require("fs"));
/**
 * Pixel size from the first bytes of a PNG / JPEG / GIF / WebP file. Reads at most 64 KB
 * (JPEG dimensions sit in the first SOF marker, usually within a few KB).
 */
function readImageSize(file) {
    const fd = fs.openSync(file, "r");
    let buf;
    try {
        buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        buf = buf.subarray(0, n);
    }
    finally {
        fs.closeSync(fd);
    }
    if (buf.length < 24)
        return null;
    // PNG: 8-byte signature, IHDR width/height at 16..24 (big-endian).
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF: "GIF8" then logical screen width/height (little-endian) at 6..10.
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // WebP: RIFF....WEBP then VP8 / VP8L / VP8X chunk.
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
        const tag = buf.toString("ascii", 12, 16);
        if (tag === "VP8X" && buf.length >= 30) {
            return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
        }
        if (tag === "VP8L" && buf.length >= 25) {
            const b = buf.readUInt32LE(21);
            return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
        }
        if (tag === "VP8 " && buf.length >= 30) {
            return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        }
        return null;
    }
    // JPEG: walk the markers to the first SOFn (C0..CF except C4/C8/CC): height, width.
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        while (i + 9 < buf.length) {
            if (buf[i] !== 0xff) {
                i += 1;
                continue;
            }
            const marker = buf[i + 1];
            if (marker === 0xff) {
                i += 1;
                continue;
            }
            const len = buf.readUInt16BE(i + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
            }
            i += 2 + len;
        }
        return null;
    }
    return null;
}
//# sourceMappingURL=imageSize.js.map