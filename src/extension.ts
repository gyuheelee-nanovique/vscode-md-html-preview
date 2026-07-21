/**
 * Extension entry point: activation, command registration, active-editor detection.
 */

import * as vscode from "vscode";
import { PreviewManager } from "./previewPanel";

function activeMarkdownEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const isMarkdown =
    editor.document.languageId === "markdown" ||
    /\.(md|markdown)$/i.test(editor.document.uri.fsPath);
  return isMarkdown ? editor : undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const manager = new PreviewManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("mdHtmlPreview.open", () => {
      const editor = activeMarkdownEditor();
      if (!editor) {
        vscode.window.showWarningMessage("먼저 Markdown 문서를 여세요.");
        return;
      }
      manager.open(editor);
    }),
    vscode.commands.registerCommand("mdHtmlPreview.exportHtml", async () => {
      const editor = activeMarkdownEditor();
      if (!editor) {
        vscode.window.showWarningMessage("먼저 Markdown 문서를 여세요.");
        return;
      }
      await manager.exportHtml(editor);
    }),
    vscode.commands.registerCommand("mdHtmlPreview.print", () => manager.print()),
    vscode.commands.registerCommand("mdHtmlPreview.toggleSlideMode", () => manager.toggleSlideMode()),
    vscode.commands.registerCommand("mdHtmlPreview.toggleTheme", () => manager.toggleTheme())
  );

  // Discard any panel restored after a window reload — the live preview is cheap to
  // reopen and we deliberately do not persist the source-document binding.
  if (vscode.window.registerWebviewPanelSerializer) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer("mdHtmlPreview", {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
          panel.dispose();
        },
      })
    );
  }
}

export function deactivate(): void {
  /* no-op */
}
