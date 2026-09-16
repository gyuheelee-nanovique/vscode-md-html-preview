"use strict";
/**
 * Preview lifecycle: a single reusable Webview panel that mirrors the active
 * Markdown document, plus the standalone HTML export.
 *
 * Responsibilities (per the plan's `previewPanel.ts` module):
 *  - create / reveal the panel beside the editor
 *  - subscribe to document changes and re-render on a debounce
 *  - rewrite image paths to Webview resource URIs (or base64 when configured)
 *  - clean up timers and the panel on disposal
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
exports.PreviewManager = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const markdownRenderer_1 = require("./markdownRenderer");
const htmlTemplate_1 = require("./htmlTemplate");
const assets_1 = require("./assets");
const imageSize_1 = require("./imageSize");
const MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
};
function guessMime(file) {
    return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
function getNonce() {
    return crypto.randomBytes(24).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}
function isRemoteOrData(rel) {
    return /^(https?:|data:)/i.test(rel);
}
/** Resolve a local relative path against `baseDir`, tolerating URL-encoded names. */
function resolveLocalPath(baseDir, rel) {
    const candidates = [rel];
    try {
        const decoded = decodeURIComponent(rel);
        if (decoded !== rel) {
            candidates.push(decoded);
        }
    }
    catch {
        /* malformed URI escape — keep the raw form */
    }
    for (const candidate of candidates) {
        const abs = path.resolve(baseDir, candidate);
        try {
            if (fs.statSync(abs).isFile()) {
                return abs;
            }
        }
        catch {
            /* not found — try next candidate */
        }
    }
    return null;
}
class PreviewManager {
    constructor(context) {
        this.context = context;
        this.currentRootPaths = [];
        /** While set (epoch ms), ignore editor scroll events — they were caused by us revealing. */
        this.ignoreEditorScrollUntil = 0;
        /** Resolvers waiting for the next `uiState` (see `queryWebviewState`). */
        this.stateWaiters = [];
        /** Intrinsic image sizes, keyed by absolute path + mtime (cheap header reads, cached). */
        this.imageSizeCache = new Map();
        /**
         * Set once the Webview's client has booted (its first `uiState`). While true, a document
         * edit is delivered as an in-place `update` message instead of replacing `webview.html`.
         */
        this.webviewReady = false;
        /** Everything but the article that went into the current page — a change forces a reload. */
        this.pageSignature = "";
        this.cssText = this.loadCss();
        this.assets = new assets_1.AssetProvider(context.extensionPath);
        context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
            if (this.sourceUri && e.document.uri.toString() === this.sourceUri.toString()) {
                this.scheduleRender();
            }
        }), vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("mdHtmlPreview")) {
                void this.render(true);
            }
        }), vscode.window.onDidChangeActiveTextEditor((editor) => {
            // Follow the active Markdown editor, like the built-in preview.
            if (this.panel && editor && editor.document.languageId === "markdown") {
                this.open(editor);
            }
        }), vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.onEditorScroll(e)));
    }
    /**
     * Editor → preview: push the source line at the editor's vertical CENTRE to the Webview.
     * If that centre line is inside an HTML comment (invisible in the preview) the update is
     * skipped, so the preview freezes on the block before the comment until the centre reaches
     * real text again.
     */
    onEditorScroll(e) {
        if (!this.panel || !this.sourceUri) {
            return;
        }
        if (e.textEditor.document.uri.toString() !== this.sourceUri.toString()) {
            return;
        }
        if (Date.now() < this.ignoreEditorScrollUntil) {
            return; // this scroll was caused by our own preview → editor reveal
        }
        if (!this.readConfig(this.sourceUri).scrollSync) {
            return;
        }
        const ranges = e.visibleRanges;
        if (ranges.length === 0) {
            return;
        }
        const first = ranges[0].start.line;
        const last = ranges[ranges.length - 1].end.line;
        const center = Math.floor((first + last) / 2);
        const mask = this.commentMaskFor(e.textEditor.document);
        if (mask[center]) {
            return; // centre line is an invisible comment — freeze the preview
        }
        this.lastEditorCenter = center;
        void this.panel.webview.postMessage({ type: "scrollToLine", line: center });
    }
    /** Comment-line mask for the document, cached per version (recomputed on edit). */
    commentMaskFor(doc) {
        if (!this.commentMaskCache || this.commentMaskCache.version !== doc.version) {
            this.commentMaskCache = { version: doc.version, mask: (0, markdownRenderer_1.commentLineMask)(doc.getText()) };
        }
        return this.commentMaskCache.mask;
    }
    /** Messages from the Webview: scroll sync, plus the right-click menu's export commands. */
    onPreviewMessage(message) {
        if (message.type === "uiState") {
            this.webviewMode = message.mode === "slide" ? "slide" : "document";
            this.webviewTheme = message.theme === "light" ? "light" : "dark";
            this.webviewReady = true;
            const waiters = this.stateWaiters;
            this.stateWaiters = [];
            for (const w of waiters)
                w();
            return;
        }
        if (message.type === "exportHtml") {
            void this.exportHtml();
            return;
        }
        if (message.type === "print") {
            void this.print();
            return;
        }
        if (message.type === "printSlides") {
            void this.printSlides();
            return;
        }
        if (!this.sourceUri || message.type !== "revealLine" || typeof message.line !== "number") {
            return;
        }
        if (!this.readConfig(this.sourceUri).scrollSync) {
            return;
        }
        const editor = vscode.window.visibleTextEditors.find((ed) => ed.document.uri.toString() === this.sourceUri?.toString());
        if (!editor) {
            return;
        }
        const line = Math.max(0, Math.min(editor.document.lineCount - 1, Math.round(message.line)));
        this.ignoreEditorScrollUntil = Date.now() + 250;
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    }
    /** Active Markdown editor's document, or the document the preview is bound to. */
    commandTargetUri() {
        const editor = vscode.window.activeTextEditor;
        if (editor &&
            (editor.document.languageId === "markdown" ||
                /\.(md|markdown)$/i.test(editor.document.uri.fsPath))) {
            return editor.document.uri;
        }
        return this.sourceUri;
    }
    /** Render the document as a self-contained HTML document (base64 images, no sync attrs). */
    /**
     * `forPrint` bakes the light theme + continuous document view into the file. Mermaid
     * renders its colours *into* the SVG, so a page opened in dark mode would still carry a
     * dark diagram onto white paper even though `@media print` resets the CSS palette —
     * generating the print file as light is what actually guarantees a light printout.
     */
    buildStandaloneHtml(uri, doc, forPrint = false, frames = false) {
        const cfg = this.readConfig(uri);
        const baseDir = uri.scheme === "file" ? path.dirname(uri.fsPath) : undefined;
        const result = (0, markdownRenderer_1.markdownToArticleHtml)(doc.getText(), {
            keepLinks: !cfg.plainCitations,
            autolinkUrls: cfg.autolinkUrls,
            removeTopImages: cfg.removeTopImages,
            openReferences: true, // keep references open for print
            resolveImage: this.makeResolveImage(baseDir, undefined, true),
            sourceLines: false,
            // Video frames carry no badge: the lecture renderer never turns slide numbers on.
            slideNumbers: frames ? false : cfg.showSlideNumbers,
            eagerImages: frames, // the frame split needs every image's box before it measures
        });
        const html = (0, htmlTemplate_1.buildHtmlDocument)({
            title: path.basename(uri.fsPath || uri.path),
            articleHtml: result.articleHtml,
            css: this.cssText + this.deckCss(uri),
            nonce: getNonce(),
            // Frames print in whatever theme the page shows (the preview's current theme; the
            // right-click menu in the browser can still switch it). The A4 document print stays
            // light — see the comment above.
            theme: frames ? this.webviewTheme ?? cfg.defaultTheme : forPrint ? "light" : cfg.defaultTheme,
            mode: frames ? "slide" : forPrint ? "document" : cfg.defaultMode,
            printFrames: frames,
            assets: this.assets.exportAssets(cfg.offlineExport),
        });
        return { html, result };
    }
    /**
     * "Print / Save as PDF": render the standalone HTML and open it in the external
     * browser, where the native print dialog works with the A4 print CSS. VS Code
     * webviews run in a sandboxed iframe without `allow-modals`, so an in-webview
     * `window.print()` is silently blocked — hence the browser hand-off.
     */
    async print() {
        // Slide mode in the preview prints as 16:9 video frames; document mode as the A4 paper.
        // Ask the live page rather than trusting the last message we happened to see.
        const boundToTarget = this.panel !== undefined &&
            this.sourceUri !== undefined &&
            this.commandTargetUri()?.toString() === this.sourceUri.toString();
        let mode = this.webviewMode;
        if (boundToTarget) {
            mode = (await this.queryWebviewState()) ?? mode;
        }
        if (mode === undefined) {
            mode = this.readConfig(this.commandTargetUri()).defaultMode;
        }
        await this.printAs(mode === "slide");
    }
    /** Round-trip to the Webview for its current mode; undefined if it does not answer in time. */
    queryWebviewState() {
        const panel = this.panel;
        if (!panel)
            return Promise.resolve(undefined);
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done)
                    return;
                done = true;
                resolve(this.webviewMode);
            };
            this.stateWaiters.push(finish);
            setTimeout(() => {
                if (!done) {
                    done = true;
                    resolve(undefined);
                }
            }, 700);
            void panel.webview.postMessage({ type: "queryState" });
        });
    }
    /** "Print Slides as 16:9 PDF": the video-frame layout regardless of the preview's mode. */
    async printSlides() {
        await this.printAs(true);
    }
    async printAs(frames) {
        const uri = this.commandTargetUri();
        if (!uri) {
            vscode.window.showWarningMessage("먼저 Markdown 문서를 열거나 미리보기를 여세요.");
            return;
        }
        let doc;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        }
        catch {
            vscode.window.showWarningMessage("문서를 열 수 없습니다.");
            return;
        }
        const { html } = this.buildStandaloneHtml(uri, doc, true, frames);
        const rawBase = path.basename(uri.fsPath || uri.path).replace(/\.(md|markdown)$/i, "");
        // Keep the temp filename ASCII-only: a non-ASCII name (e.g. Korean) gets percent-
        // encoded by Uri.file and ShellExecute then fails to find the literal file (error 0x2).
        const base = rawBase.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "preview";
        const kind = frames ? "-frames" : "";
        const tmpPath = path.join(os.tmpdir(), `mdpreview-${base}${kind}-${crypto.randomBytes(3).toString("hex")}.html`);
        try {
            fs.writeFileSync(tmpPath, html, "utf8");
        }
        catch (err) {
            vscode.window.showErrorMessage(`인쇄용 HTML 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        this.openInBrowser(tmpPath);
        vscode.window.setStatusBarMessage(frames
            ? "16:9 슬라이드(영상 프레임)로 인쇄하거나 PDF로 저장하세요 (Cmd/Ctrl+P · 배경 그래픽 켜기 · 여백 없음)."
            : "브라우저에서 인쇄하거나 PDF로 저장하세요 (Cmd/Ctrl+P).", 8000);
    }
    /** Toggle document ⇄ slide view in the live preview (no-op with a hint if none is open). */
    toggleSlideMode() {
        if (!this.panel) {
            vscode.window.showInformationMessage("먼저 미리보기를 여세요 (Markdown HTML Preview: Open).");
            return;
        }
        void this.panel.webview.postMessage({ type: "setMode", mode: "toggle" });
    }
    /** Toggle light ⇄ dark theme in the live preview. */
    toggleTheme() {
        if (!this.panel) {
            vscode.window.showInformationMessage("먼저 미리보기를 여세요 (Markdown HTML Preview: Open).");
            return;
        }
        void this.panel.webview.postMessage({ type: "setTheme", theme: "toggle" });
    }
    /**
     * Open a local file in the OS default app (the browser, for .html) using the RAW
     * filesystem path. `vscode.env.openExternal(Uri.file(...))` percent-encodes the path,
     * which makes ShellExecute fail to find non-ASCII (e.g. Korean) paths on Windows
     * (error 0x2); spawning the platform opener with the verbatim path avoids that. Falls
     * back to openExternal if the opener binary itself cannot be spawned.
     */
    openInBrowser(filePath) {
        const platform = process.platform;
        const opener = platform === "win32"
            ? { cmd: "explorer.exe", args: [filePath] }
            : platform === "darwin"
                ? { cmd: "open", args: [filePath] }
                : { cmd: "xdg-open", args: [filePath] };
        try {
            // explorer.exe exits with code 1 even on success, so only a spawn ERROR (binary not
            // found) triggers the fallback.
            const child = (0, child_process_1.spawn)(opener.cmd, opener.args, { detached: true, stdio: "ignore" });
            child.on("error", () => {
                void vscode.env.openExternal(vscode.Uri.file(filePath));
            });
            child.unref();
        }
        catch {
            void vscode.env.openExternal(vscode.Uri.file(filePath));
        }
    }
    loadCss() {
        const cssPath = path.join(this.context.extensionPath, "media", "preview.css");
        try {
            return fs.readFileSync(cssPath, "utf8");
        }
        catch {
            return "/* preview.css missing */";
        }
    }
    /**
     * A per-course stylesheet that lives beside the document, appended AFTER preview.css so it
     * wins. Walk up from the file for at most six levels looking for `_deck.css` — the same
     * rule (and the same cap) as the batch renderer `render_md_html.js:findDeckCss`, so the
     * preview, "Save as PDF", and the lecture pipeline all resolve to one file.
     *
     * Keep the two in step: a course puts its print-only corrections there (e.g. the CFD deck
     * pins mermaid label metrics under `@media print`), and if only one path reads it the
     * preview and the printed PDF disagree in ways that are invisible on screen.
     */
    deckCss(uri) {
        if (!uri || uri.scheme !== "file")
            return "";
        let dir = path.dirname(uri.fsPath);
        for (let i = 0; i < 6; i++) {
            const p = path.join(dir, "_deck.css");
            try {
                if (fs.existsSync(p)) {
                    return "\n\n/* ---- 덱 CSS: " + p + " ---- */\n" + fs.readFileSync(p, "utf8");
                }
            }
            catch {
                /* unreadable — treat as absent */
            }
            const up = path.dirname(dir);
            if (up === dir)
                break;
            dir = up;
        }
        return "";
    }
    readConfig(scope) {
        const cfg = vscode.workspace.getConfiguration("mdHtmlPreview", scope ?? null);
        return {
            embedImages: cfg.get("embedImages", false),
            openReferences: cfg.get("openReferences", true),
            removeTopImages: Math.max(0, cfg.get("removeTopImages", 0)),
            plainCitations: cfg.get("plainCitations", true),
            autolinkUrls: cfg.get("autolinkUrls", true),
            debounceMs: Math.max(0, cfg.get("debounceMs", 200)),
            scrollSync: cfg.get("scrollSync", true),
            defaultTheme: cfg.get("defaultTheme", "dark") === "light" ? "light" : "dark",
            defaultMode: cfg.get("defaultMode", "document") === "slide" ? "slide" : "document",
            offlineExport: cfg.get("offlineExport", true),
            showSlideNumbers: cfg.get("showSlideNumbers", true),
        };
    }
    titleFor(uri) {
        return `HTML Preview — ${path.basename(uri.fsPath || uri.path)}`;
    }
    /**
     * Resource roots the Webview may load files from: the extension, the document's own
     * directory, every workspace folder, and the directories that actually contain the
     * document's (possibly parent-relative) images — otherwise asWebviewUri produces URIs
     * the Webview resource loader silently refuses to serve.
     */
    rootsFor(uri, mdText) {
        const seen = new Set();
        const roots = [];
        const add = (u) => {
            if (!seen.has(u.fsPath)) {
                seen.add(u.fsPath);
                roots.push(u);
            }
        };
        add(this.context.extensionUri);
        let baseDir;
        if (uri.scheme === "file") {
            baseDir = path.dirname(uri.fsPath);
            add(vscode.Uri.file(baseDir));
        }
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            add(folder.uri);
        }
        if (baseDir) {
            for (const rel of mdText.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
                const target = rel[1].trim();
                if (isRemoteOrData(target)) {
                    continue;
                }
                const abs = resolveLocalPath(baseDir, target);
                if (abs) {
                    add(vscode.Uri.file(path.dirname(abs)));
                }
            }
        }
        return roots;
    }
    /** Whether the live panel's roots already cover every directory `roots` needs. */
    rootsCover(roots) {
        return roots.every((r) => this.currentRootPaths.some((have) => r.fsPath === have || r.fsPath.startsWith(have + path.sep)));
    }
    /** Open (or re-target) the preview for the given editor's document. */
    open(editor) {
        const uri = editor.document.uri;
        this.sourceUri = uri;
        const roots = this.rootsFor(uri, editor.document.getText());
        // Reuse the panel when its roots already cover the new document; otherwise recreate
        // it (localResourceRoots can only be set at construction time).
        if (this.panel && !this.rootsCover(roots)) {
            this.panel.dispose();
        }
        if (!this.panel) {
            const panel = vscode.window.createWebviewPanel("mdHtmlPreview", this.titleFor(uri), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: roots,
            });
            this.panel = panel;
            this.webviewReady = false; // a new page has to boot before it can take in-place updates
            this.pageSignature = "";
            this.currentRootPaths = roots.map((r) => r.fsPath);
            // Track this panel's subscriptions in a per-panel store (disposed when it fires),
            // not context.subscriptions, so re-creating the panel does not leak dead listeners.
            const panelDisposables = [];
            panel.webview.onDidReceiveMessage((m) => this.onPreviewMessage(m), null, panelDisposables);
            panel.onDidDispose(() => {
                this.webviewReady = false;
                if (this.panel === panel) {
                    this.panel = undefined;
                    this.currentRootPaths = [];
                    this.clearDebounce();
                }
                panelDisposables.forEach((d) => d.dispose());
                panelDisposables.length = 0;
            }, null, panelDisposables);
        }
        else {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }
        void this.render();
    }
    scheduleRender() {
        if (!this.sourceUri) {
            return;
        }
        const { debounceMs } = this.readConfig(this.sourceUri);
        this.clearDebounce();
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            void this.render();
        }, debounceMs);
    }
    clearDebounce() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }
    makeResolveImage(baseDir, webview, embed) {
        return (rel) => {
            if (isRemoteOrData(rel)) {
                return rel;
            }
            if (!baseDir) {
                return null;
            }
            const abs = resolveLocalPath(baseDir, rel);
            if (!abs) {
                return null;
            }
            if (embed) {
                try {
                    const data = fs.readFileSync(abs).toString("base64");
                    return `data:${guessMime(abs)};base64,${data}`;
                }
                catch {
                    return null;
                }
            }
            if (webview) {
                return webview.asWebviewUri(vscode.Uri.file(abs)).toString();
            }
            return null;
        };
    }
    async render(forceReload = false) {
        if (!this.panel || !this.sourceUri) {
            return;
        }
        let doc;
        try {
            doc = await vscode.workspace.openTextDocument(this.sourceUri);
        }
        catch {
            return;
        }
        // A late async resolution may arrive after the panel was closed / re-targeted.
        if (!this.panel || !this.sourceUri || doc.uri.toString() !== this.sourceUri.toString()) {
            return;
        }
        const cfg = this.readConfig(this.sourceUri);
        const baseDir = this.sourceUri.scheme === "file" ? path.dirname(this.sourceUri.fsPath) : undefined;
        const webview = this.panel.webview;
        const options = {
            keepLinks: !cfg.plainCitations,
            autolinkUrls: cfg.autolinkUrls,
            removeTopImages: cfg.removeTopImages,
            openReferences: cfg.openReferences,
            resolveImage: this.makeResolveImage(baseDir, webview, cfg.embedImages),
            slideNumbers: cfg.showSlideNumbers,
            // Both keep the layout from shifting after the page loads (which is what made the
            // scroll-sync land on the wrong text and then yank the editor along):
            eagerImages: true,
            imageSize: this.makeImageSize(baseDir),
        };
        const result = (0, markdownRenderer_1.markdownToArticleHtml)(doc.getText(), options);
        const css = this.cssText + this.deckCss(this.sourceUri);
        // Anything outside the article that shapes the page. Same signature → the page can take
        // the new article in place; different → rebuild the whole document.
        const signature = JSON.stringify([
            this.sourceUri.toString(),
            css.length,
            cfg.scrollSync,
            cfg.defaultTheme,
            cfg.defaultMode,
            cfg.embedImages,
            cfg.showSlideNumbers,
            result.articleHtml.includes('class="language-'),
            result.articleHtml.includes('class="mermaid"'),
        ]);
        // The reload / update re-centres the preview itself; nothing the editor reports in the
        // next moments is a user scroll (matches the client's SETTLE_MS).
        this.ignoreEditorScrollUntil = Date.now() + 800;
        if (!forceReload && this.webviewReady && signature === this.pageSignature) {
            void webview.postMessage({
                type: "update",
                articleHtml: result.articleHtml,
                anchorLine: this.lastEditorCenter,
            });
            this.panel.title = this.titleFor(this.sourceUri);
            return;
        }
        const html = (0, htmlTemplate_1.buildHtmlDocument)({
            title: this.titleFor(this.sourceUri),
            articleHtml: result.articleHtml,
            css,
            cspSource: webview.cspSource,
            nonce: getNonce(),
            scrollSync: cfg.scrollSync,
            theme: cfg.defaultTheme,
            mode: cfg.defaultMode,
            anchorLine: this.lastEditorCenter,
            assets: this.assets.previewAssets(webview),
        });
        this.webviewReady = false;
        this.pageSignature = signature;
        webview.html = html;
        this.panel.title = this.titleFor(this.sourceUri);
    }
    /**
     * Intrinsic size of a local image from its file header (PNG / JPEG / GIF / WebP), so the
     * renderer can emit `width`/`height` and the box has its aspect ratio before the bytes
     * arrive. Unknown formats (SVG, remote, data:) return null and render as before.
     */
    makeImageSize(baseDir) {
        return (rel) => {
            if (!baseDir || isRemoteOrData(rel))
                return null;
            const abs = resolveLocalPath(baseDir, rel);
            if (!abs)
                return null;
            let key = abs;
            try {
                key = `${abs}|${fs.statSync(abs).mtimeMs}`;
            }
            catch {
                return null;
            }
            const hit = this.imageSizeCache.get(key);
            if (hit !== undefined)
                return hit;
            let dims = null;
            try {
                dims = (0, imageSize_1.readImageSize)(abs);
            }
            catch {
                dims = null;
            }
            this.imageSizeCache.set(key, dims);
            return dims;
        };
    }
    /**
     * Save the document as a single standalone HTML file, chosen through the OS save dialog.
     *
     * With `offlineExport` on (the default) the file embeds everything it needs — images as
     * base64, the webfont, KaTeX and its fonts, highlight.js and Mermaid as inline script —
     * so it opens by double-click on any machine, with no network, no extension and no
     * sibling files. Callable from the command palette, the editor context menu, and the
     * preview's own right-click menu, so it resolves its target the same way `print` does.
     */
    async exportHtml() {
        const uri = this.commandTargetUri();
        if (!uri) {
            vscode.window.showWarningMessage("먼저 Markdown 문서를 열거나 미리보기를 여세요.");
            return;
        }
        if (uri.scheme !== "file") {
            vscode.window.showWarningMessage("저장된 파일에서만 HTML로 내보낼 수 있습니다.");
            return;
        }
        let doc;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        }
        catch {
            vscode.window.showWarningMessage("문서를 열 수 없습니다.");
            return;
        }
        const base = path.basename(uri.fsPath).replace(/\.(md|markdown)$/i, "");
        // The save dialog also handles the overwrite confirmation, natively and per-platform.
        const target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), `${base}.html`)),
            filters: { HTML: ["html", "htm"] },
            saveLabel: "HTML로 저장",
        });
        if (!target) {
            return;
        }
        const { html, result } = this.buildStandaloneHtml(uri, doc);
        try {
            fs.writeFileSync(target.fsPath, html, "utf8");
        }
        catch (err) {
            vscode.window.showErrorMessage(`HTML 내보내기 실패: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        const notes = [`${result.renderedImages}개 이미지 포함`];
        if (result.missingImages.length > 0) {
            notes.push(`누락 ${result.missingImages.length}개`);
        }
        notes.push(`${(Buffer.byteLength(html, "utf8") / 1024 / 1024).toFixed(1)} MB`);
        if (!this.readConfig(uri).offlineExport || !this.assets.offlineCapable) {
            notes.push("CDN 필요");
        }
        const open = await vscode.window.showInformationMessage(`HTML 저장 완료: ${path.basename(target.fsPath)} (${notes.join(", ")})`, "열기");
        if (open === "열기") {
            this.openInBrowser(target.fsPath);
        }
    }
}
exports.PreviewManager = PreviewManager;
//# sourceMappingURL=previewPanel.js.map