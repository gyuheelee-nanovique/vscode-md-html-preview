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
- **Clickable web addresses** — bare URLs (`https://…`, `<https://…>`) become clickable
  links in the live preview, the saved standalone HTML, and the printed PDF, even while
  citations stay plain (toggle with `mdHtmlPreview.autolinkUrls`).
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
- **Offline standalone HTML** — `Markdown HTML Preview: Save Standalone HTML` asks where
  to save and writes a **single self-contained file**: images, the webfont, KaTeX and its
  fonts, highlight.js and Mermaid are all embedded. It opens by double-click on any
  machine — no network, no extension, no sibling files. Turn off
  `mdHtmlPreview.offlineExport` to link those assets from a CDN instead and keep the file
  small.

## Commands

| Command | ID | Default key |
| --- | --- | --- |
| Markdown HTML Preview: Open | `mdHtmlPreview.open` | `Ctrl/Cmd+Shift+Alt+V` |
| Markdown HTML Preview: Print / Save as PDF | `mdHtmlPreview.print` | `Ctrl/Cmd+'` |
| Markdown HTML Preview: Save Standalone HTML | `mdHtmlPreview.exportHtml` | — |

There is also an `Open` button in the editor title bar for Markdown files. The print
shortcut works while either the Markdown editor or the preview panel is focused.

**Right-click** inside the preview for theme (light / dark), view mode (document / slide),
`HTML로 저장…`, and `인쇄 / PDF로 저장…`. Right-clicking in a Markdown **editor** also
offers `Save Standalone HTML`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mdHtmlPreview.embedImages` | `false` | Embed images as base64 in the live preview (export always embeds). |
| `mdHtmlPreview.openReferences` | `true` | Open the references `<details>` by default. |
| `mdHtmlPreview.removeTopImages` | `0` | Drop the first N images (publisher logos / decorative headers). |
| `mdHtmlPreview.plainCitations` | `true` | Render Markdown links as plain text (no `<a>`). |
| `mdHtmlPreview.autolinkUrls` | `true` | Turn bare web addresses into clickable links (preview / HTML / PDF). |
| `mdHtmlPreview.debounceMs` | `200` | Debounce delay between an edit and the refresh. |
| `mdHtmlPreview.scrollSync` | `true` | Keep editor and preview scroll positions in sync (both directions). |
| `mdHtmlPreview.defaultTheme` | `dark` | Theme a freshly opened preview starts in (printing is always light). |
| `mdHtmlPreview.defaultMode` | `document` | View a freshly opened preview starts in (`slide` paginates on `---`). |
| `mdHtmlPreview.offlineExport` | `true` | Embed every asset in the saved / printed HTML so it opens with no network. |

## Build / run

```bash
cd vscode-md-html-preview
npm install                    # TypeScript + type definitions (dev only)
node dist/fetch-vendor.mjs     # third-party assets -> media/vendor/ (committed; run once)
npm run compile                # tsc -> out/
```

Then press **F5** in VS Code (with this folder open) to launch an Extension
Development Host, open a Markdown file, and run **Markdown HTML Preview: Open**.

To package and install the real artifact (requires `@vscode/vsce`):

```bash
npx @vscode/vsce package --out dist/vscode-md-html-preview.vsix
code --install-extension dist/vscode-md-html-preview.vsix --force
```

Copying this folder into `~/.vscode/extensions/` does **not** work on current VS Code —
extensions must be installed from a `.vsix` through the CLI. See
[DISTRIBUTION.md](DISTRIBUTION.md) for the release flow and multi-machine auto-update.

## Notes

- **Nothing loads from the network.** KaTeX (+ its 20 woff2 faces), highlight.js,
  Mermaid and the Freesentation webfont are vendored under `media/vendor/` by
  `dist/fetch-vendor.mjs` and ship inside the extension. The preview links them as
  Webview resource URIs (cheap — it re-renders on every keystroke); a saved file inlines
  them, which is what makes it portable. If `media/vendor/` is absent, both quietly fall
  back to jsDelivr and behave as before.
- The Content-Security-Policy grants `default-src 'none'` and names the CDN origin only
  when an asset actually came from there. Scripts run only with a per-render nonce;
  `script-src 'unsafe-inline'` is never enabled.
- A saved file is ~1.5 MB, or ~5 MB when it contains Mermaid diagrams (the Mermaid
  bundle alone is 3.5 MB and is only included when a diagram is present).
- This extension has **no runtime npm dependencies** — the renderer is self-contained
  TypeScript. Only build-time dev dependencies (`typescript`, `@types/*`) are needed.
