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
        this.cssText = this.loadCss();
        context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
            if (this.sourceUri && e.document.uri.toString() === this.sourceUri.toString()) {
                this.scheduleRender();
            }
        }), vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("mdHtmlPreview")) {
                void this.render();
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
        void this.panel.webview.postMessage({ type: "scrollToLine", line: center });
    }
    /** Comment-line mask for the document, cached per version (recomputed on edit). */
    commentMaskFor(doc) {
        if (!this.commentMaskCache || this.commentMaskCache.version !== doc.version) {
            this.commentMaskCache = { version: doc.version, mask: (0, markdownRenderer_1.commentLineMask)(doc.getText()) };
        }
        return this.commentMaskCache.mask;
    }
    /** Preview → editor: reveal the reported source line CENTERED in the source editor. */
    onPreviewMessage(message) {
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
    buildStandaloneHtml(uri, doc, forPrint = false) {
        const cfg = this.readConfig(uri);
        const baseDir = uri.scheme === "file" ? path.dirname(uri.fsPath) : undefined;
        const result = (0, markdownRenderer_1.markdownToArticleHtml)(doc.getText(), {
            keepLinks: !cfg.plainCitations,
            removeTopImages: cfg.removeTopImages,
            openReferences: true, // keep references open for print
            resolveImage: this.makeResolveImage(baseDir, undefined, true),
            sourceLines: false,
        });
        const html = (0, htmlTemplate_1.buildHtmlDocument)({
            title: path.basename(uri.fsPath || uri.path),
            articleHtml: result.articleHtml,
            css: this.cssText,
            nonce: getNonce(),
            theme: forPrint ? "light" : cfg.defaultTheme,
            mode: forPrint ? "document" : cfg.defaultMode,
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
        const { html } = this.buildStandaloneHtml(uri, doc, true);
        const rawBase = path.basename(uri.fsPath || uri.path).replace(/\.(md|markdown)$/i, "");
        // Keep the temp filename ASCII-only: a non-ASCII name (e.g. Korean) gets percent-
        // encoded by Uri.file and ShellExecute then fails to find the literal file (error 0x2).
        const base = rawBase.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "preview";
        const tmpPath = path.join(os.tmpdir(), `mdpreview-${base}-${crypto.randomBytes(3).toString("hex")}.html`);
        try {
            fs.writeFileSync(tmpPath, html, "utf8");
        }
        catch (err) {
            vscode.window.showErrorMessage(`인쇄용 HTML 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        this.openInBrowser(tmpPath);
        vscode.window.setStatusBarMessage("브라우저에서 인쇄하거나 PDF로 저장하세요 (Cmd/Ctrl+P).", 6000);
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
    readConfig(scope) {
        const cfg = vscode.workspace.getConfiguration("mdHtmlPreview", scope ?? null);
        return {
            embedImages: cfg.get("embedImages", false),
            openReferences: cfg.get("openReferences", true),
            removeTopImages: Math.max(0, cfg.get("removeTopImages", 0)),
            plainCitations: cfg.get("plainCitations", true),
            debounceMs: Math.max(0, cfg.get("debounceMs", 200)),
            scrollSync: cfg.get("scrollSync", true),
            defaultTheme: cfg.get("defaultTheme", "dark") === "light" ? "light" : "dark",
            defaultMode: cfg.get("defaultMode", "document") === "slide" ? "slide" : "document",
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
            this.currentRootPaths = roots.map((r) => r.fsPath);
            // Track this panel's subscriptions in a per-panel store (disposed when it fires),
            // not context.subscriptions, so re-creating the panel does not leak dead listeners.
            const panelDisposables = [];
            panel.webview.onDidReceiveMessage((m) => this.onPreviewMessage(m), null, panelDisposables);
            panel.onDidDispose(() => {
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
    async render() {
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
            removeTopImages: cfg.removeTopImages,
            openReferences: cfg.openReferences,
            resolveImage: this.makeResolveImage(baseDir, webview, cfg.embedImages),
        };
        const result = (0, markdownRenderer_1.markdownToArticleHtml)(doc.getText(), options);
        const html = (0, htmlTemplate_1.buildHtmlDocument)({
            title: this.titleFor(this.sourceUri),
            articleHtml: result.articleHtml,
            css: this.cssText,
            cspSource: webview.cspSource,
            nonce: getNonce(),
            scrollSync: cfg.scrollSync,
            theme: cfg.defaultTheme,
            mode: cfg.defaultMode,
        });
        webview.html = html;
        this.panel.title = this.titleFor(this.sourceUri);
    }
    /** Build a standalone HTML file (images embedded as base64) next to the source. */
    async exportHtml(editor) {
        const doc = editor.document;
        const uri = doc.uri;
        if (uri.scheme !== "file") {
            vscode.window.showWarningMessage("저장된 파일에서만 HTML로 내보낼 수 있습니다.");
            return;
        }
        const { html, result } = this.buildStandaloneHtml(uri, doc);
        const base = path.basename(uri.fsPath).replace(/\.(md|markdown)$/i, "");
        const outPath = path.join(path.dirname(uri.fsPath), `${base}.html`);
        if (fs.existsSync(outPath)) {
            const choice = await vscode.window.showWarningMessage(`${path.basename(outPath)} 파일이 이미 있습니다. 덮어쓸까요?`, { modal: true }, "덮어쓰기");
            if (choice !== "덮어쓰기") {
                return;
            }
        }
        try {
            fs.writeFileSync(outPath, html, "utf8");
        }
        catch (err) {
            vscode.window.showErrorMessage(`HTML 내보내기 실패: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        const notes = [`${result.renderedImages}개 이미지 포함`];
        if (result.missingImages.length > 0) {
            notes.push(`누락 ${result.missingImages.length}개`);
        }
        const open = await vscode.window.showInformationMessage(`HTML 내보내기 완료: ${path.basename(outPath)} (${notes.join(", ")})`, "열기");
        if (open === "열기") {
            void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(outPath));
        }
    }
}
exports.PreviewManager = PreviewManager;
//# sourceMappingURL=previewPanel.js.map