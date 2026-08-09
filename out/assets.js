"use strict";
/**
 * Third-party asset plumbing (KaTeX, highlight.js, Mermaid, the 'Presentation' webfont).
 *
 * The files live in `media/vendor/`, fetched by `dist/fetch-vendor.mjs` and shipped inside
 * the extension, so nothing in a rendered page ever needs the network. They are served two
 * different ways:
 *
 *  - **preview** — as Webview resource URIs. The webview re-renders on every (debounced)
 *    keystroke, so the HTML string it builds must stay small; the browser caches the files.
 *  - **export / print** — inlined into the document itself (script text, CSS text, base64
 *    `data:` fonts), which is what makes a saved `.html` open on a machine with no network,
 *    no extension and no sibling files.
 *
 * If `media/vendor/` is missing (e.g. a source checkout where `fetch-vendor` never ran) the
 * provider falls back to the jsDelivr URLs and the page behaves as it did before — online
 * only. `usesCdn` reports that, so the template can widen the CSP accordingly.
 */
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
exports.AssetProvider = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const htmlTemplate_1 = require("./htmlTemplate");
const VENDOR = ["media", "vendor"];
/** The 'Presentation' faces, and the weight each one supplies. */
const FONT_FACES = [
    { file: "Freesentation-4Regular.woff2", weight: 400 },
    { file: "Freesentation-7Bold.woff2", weight: 700 },
];
function fontFaceRule(weight, url) {
    return (`@font-face{font-family:'Presentation';src:url("${url}") format('woff2');` +
        `font-weight:${weight};font-style:normal;font-display:swap}`);
}
class AssetProvider {
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        /** Text/data-URI cache, keyed by vendor-relative path. Vendored files never change at runtime. */
        this.cache = new Map();
    }
    abs(rel) {
        return path.join(this.extensionPath, ...VENDOR, rel);
    }
    /** True when the vendored assets are present, i.e. offline rendering is possible. */
    get offlineCapable() {
        return fs.existsSync(this.abs("katex.min.js")) && fs.existsSync(this.abs("mermaid.min.js"));
    }
    text(rel) {
        const key = `t:${rel}`;
        const hit = this.cache.get(key);
        if (hit !== undefined) {
            return hit;
        }
        try {
            const value = fs.readFileSync(this.abs(rel), "utf8");
            this.cache.set(key, value);
            return value;
        }
        catch {
            return null;
        }
    }
    dataUri(rel, mime) {
        const key = `d:${rel}`;
        const hit = this.cache.get(key);
        if (hit !== undefined) {
            return hit;
        }
        try {
            const value = `data:${mime};base64,${fs.readFileSync(this.abs(rel)).toString("base64")}`;
            this.cache.set(key, value);
            return value;
        }
        catch {
            return null;
        }
    }
    webviewUri(webview, rel) {
        return webview.asWebviewUri(vscode.Uri.file(this.abs(rel))).toString();
    }
    /** Assets for the live preview: local files by Webview URI, jsDelivr when not vendored. */
    previewAssets(webview) {
        if (!this.offlineCapable) {
            return htmlTemplate_1.CDN_ASSETS;
        }
        const fontCss = FONT_FACES.map((f) => fontFaceRule(f.weight, this.webviewUri(webview, f.file))).join("\n");
        return {
            fontCss,
            // katex.min.css keeps its relative url(fonts/…) references, which resolve against the
            // stylesheet's own Webview URI — media/vendor/fonts/ is inside a localResourceRoot.
            katexCss: { href: this.webviewUri(webview, "katex.min.css") },
            katexJs: { href: this.webviewUri(webview, "katex.min.js") },
            hljsJs: { href: this.webviewUri(webview, "highlight.min.js") },
            mermaidJs: { href: this.webviewUri(webview, "mermaid.min.js") },
            usesCdn: false,
        };
    }
    /**
     * Assets for a standalone file. With `offline` (the default) everything is inlined so the
     * result opens anywhere; otherwise it links jsDelivr, which keeps the file ~1.5 MB smaller
     * at the cost of needing a connection.
     */
    exportAssets(offline) {
        if (!offline || !this.offlineCapable) {
            return htmlTemplate_1.CDN_ASSETS;
        }
        if (!this.exportCache) {
            this.exportCache = this.buildExportAssets();
        }
        return this.exportCache;
    }
    buildExportAssets() {
        const fontCss = FONT_FACES.map((f) => {
            const uri = this.dataUri(f.file, "font/woff2");
            return uri ? fontFaceRule(f.weight, uri) : "";
        })
            .filter(Boolean)
            .join("\n");
        // Rewrite KaTeX's relative font references to data URIs — an exported file has no
        // sibling fonts/ directory to resolve them against.
        const rawKatexCss = this.text("katex.min.css");
        const katexCss = rawKatexCss
            ? rawKatexCss.replace(/url\(\s*fonts\/([^)\s"']+\.woff2)\s*\)/g, (whole, name) => {
                const uri = this.dataUri(path.posix.join("fonts", name), "font/woff2");
                return uri ? `url("${uri}")` : whole;
            })
            : null;
        // A partially vendored checkout falls back per asset rather than all-or-nothing, so
        // track whether any single fallback fired — that alone forces the CDN back into the CSP.
        let fellBack = fontCss === "" || katexCss === null;
        const inlineOr = (rel, fallback) => {
            const body = this.text(rel);
            if (body === null) {
                fellBack = true;
                return fallback;
            }
            return { text: body };
        };
        const katexJs = inlineOr("katex.min.js", htmlTemplate_1.CDN_ASSETS.katexJs);
        const hljsJs = inlineOr("highlight.min.js", htmlTemplate_1.CDN_ASSETS.hljsJs);
        const mermaidJs = inlineOr("mermaid.min.js", htmlTemplate_1.CDN_ASSETS.mermaidJs);
        return {
            fontCss: fontCss || htmlTemplate_1.CDN_ASSETS.fontCss,
            katexCss: katexCss === null ? htmlTemplate_1.CDN_ASSETS.katexCss : { text: katexCss },
            katexJs,
            hljsJs,
            mermaidJs,
            usesCdn: fellBack,
        };
    }
}
exports.AssetProvider = AssetProvider;
//# sourceMappingURL=assets.js.map