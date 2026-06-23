"use strict";
/**
 * Extension entry point: activation, command registration, active-editor detection.
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const previewPanel_1 = require("./previewPanel");
function activeMarkdownEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const isMarkdown = editor.document.languageId === "markdown" ||
        /\.(md|markdown)$/i.test(editor.document.uri.fsPath);
    return isMarkdown ? editor : undefined;
}
function activate(context) {
    const manager = new previewPanel_1.PreviewManager(context);
    context.subscriptions.push(vscode.commands.registerCommand("mdHtmlPreview.open", () => {
        const editor = activeMarkdownEditor();
        if (!editor) {
            vscode.window.showWarningMessage("먼저 Markdown 문서를 여세요.");
            return;
        }
        manager.open(editor);
    }), vscode.commands.registerCommand("mdHtmlPreview.exportHtml", async () => {
        const editor = activeMarkdownEditor();
        if (!editor) {
            vscode.window.showWarningMessage("먼저 Markdown 문서를 여세요.");
            return;
        }
        await manager.exportHtml(editor);
    }), vscode.commands.registerCommand("mdHtmlPreview.print", () => manager.print()));
    // Discard any panel restored after a window reload — the live preview is cheap to
    // reopen and we deliberately do not persist the source-document binding.
    if (vscode.window.registerWebviewPanelSerializer) {
        context.subscriptions.push(vscode.window.registerWebviewPanelSerializer("mdHtmlPreview", {
            async deserializeWebviewPanel(panel) {
                panel.dispose();
            },
        }));
    }
}
function deactivate() {
    /* no-op */
}
//# sourceMappingURL=extension.js.map