# Markdown HTML Preview (Paper)

A VS Code extension that renders Markdown to a **live HTML preview** in a side panel,
tuned for the PDF → Korean Markdown → HTML pipeline in this repository
(`tools/pdf_to_html.py`). It is not a general replacement for VS Code's built-in
Markdown preview — it focuses on **paper conversion output**:

- PDF / docling Markdown
- image-heavy papers
- KaTeX math
- documents meant to be printed to A4 HTML

The preview uses the **same CSS, KaTeX setup, references folding, and table handling**
as the standalone HTML exporter, so what you see while editing is what the exported
`.html` file looks like.

## Features

- **Live preview** — `Markdown HTML Preview: Open` renders the active Markdown to a
  Webview beside the editor and refreshes (debounced) as you type.
- **Images** — relative image links are rewritten to Webview resource URIs (fast for
  live editing) or embedded as base64 (`mdHtmlPreview.embedImages`).
- **KaTeX math** — inline `$…$` and `` ```math `` blocks render via KaTeX using a
  conservative span-based approach that does **not** swallow citation brackets like
  `[12]`.
- **Foldable references** — the `참고문헌` section is wrapped in `<details>` (open by
  default; configurable).
- **Docling tables** — pipe tables, table captions (`표 N …`), and the special
  liposome "simulation" table are rendered with horizontal scrolling for wide tables.
- **Plain citations** — `[text](url)` links are stripped to plain text by default to
  match the paper pipeline (toggle with `mdHtmlPreview.plainCitations`).
- **Scroll sync** — the editor and the preview stay aligned in **both directions**
  (scroll either side, the other follows), mapped via `data-source-line` markers.
  Toggle with `mdHtmlPreview.scrollSync`.
- **Print / Save as PDF** — `Markdown HTML Preview: Print / Save as PDF`
  (`Ctrl/Cmd+'`) renders the standalone HTML and opens it in your **external browser**,
  where `Ctrl/Cmd+P` prints or saves to PDF with the A4 print CSS. (VS Code webviews are
  sandboxed without `allow-modals`, so an in-webview `window.print()` is blocked — the
  browser hand-off is the reliable path.)
- **A4 print CSS** — `@page { size: A4 }`, repeating table headers, and break-avoid
  rules, so browser print / PDF looks right.
- **Standalone export** — `Markdown HTML Preview: Export Standalone HTML` writes
  `<name>.html` next to the source with all local images embedded as base64.

## Commands

| Command | ID | Default key |
| --- | --- | --- |
| Markdown HTML Preview: Open | `mdHtmlPreview.open` | `Ctrl/Cmd+Shift+Alt+V` |
| Markdown HTML Preview: Print / Save as PDF | `mdHtmlPreview.print` | `Ctrl/Cmd+'` |
| Markdown HTML Preview: Export Standalone HTML | `mdHtmlPreview.exportHtml` | — |

There is also an `Open` button in the editor title bar for Markdown files. The print
shortcut works while either the Markdown editor or the preview panel is focused.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mdHtmlPreview.embedImages` | `false` | Embed images as base64 in the live preview (export always embeds). |
| `mdHtmlPreview.openReferences` | `true` | Open the references `<details>` by default. |
| `mdHtmlPreview.removeTopImages` | `0` | Drop the first N images (publisher logos / decorative headers). |
| `mdHtmlPreview.plainCitations` | `true` | Render Markdown links as plain text (no `<a>`). |
| `mdHtmlPreview.debounceMs` | `200` | Debounce delay between an edit and the refresh. |
| `mdHtmlPreview.scrollSync` | `true` | Keep editor and preview scroll positions in sync (both directions). |

## Build / run

```bash
cd vscode-md-html-preview
npm install      # installs TypeScript + type definitions (dev only)
npm run compile  # tsc -> out/
```

Then press **F5** in VS Code (with this folder open) to launch an Extension
Development Host, open a Markdown file, and run **Markdown HTML Preview: Open**.

To package a `.vsix` (requires `@vscode/vsce`):

```bash
npx @vscode/vsce package
```

## Notes

- The Webview Content-Security-Policy allows `https://cdn.jsdelivr.net` for KaTeX and
  the Freesentation font, the Webview's own resource origin for local images, plus
  `data:`/`https:` images. Scripts run only with a per-render nonce.
- KaTeX and the font load from CDN, so the live preview needs network access. The
  exported standalone HTML also references those CDNs; bundling them locally is a
  possible future enhancement (see the development plan).
- This extension has **no runtime npm dependencies** — the renderer is self-contained
  TypeScript. Only build-time dev dependencies (`typescript`, `@types/*`) are needed.
