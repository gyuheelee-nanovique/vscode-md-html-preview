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

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { AssetRef, TemplateAssets, CDN_ASSETS } from "./htmlTemplate";

const VENDOR = ["media", "vendor"];

/** The 'Presentation' faces, and the weight each one supplies. */
const FONT_FACES: Array<{ file: string; weight: number }> = [
  { file: "Freesentation-4Regular.woff2", weight: 400 },
  { file: "Freesentation-7Bold.woff2", weight: 700 },
];

function fontFaceRule(weight: number, url: string): string {
  return (
    `@font-face{font-family:'Presentation';src:url("${url}") format('woff2');` +
    `font-weight:${weight};font-style:normal;font-display:swap}`
  );
}

export class AssetProvider {
  /** Text/data-URI cache, keyed by vendor-relative path. Vendored files never change at runtime. */
  private readonly cache = new Map<string, string>();
  /** Fully built export bundle — assembling it means base64-ing ~1.5 MB, so build it once. */
  private exportCache: TemplateAssets | undefined;

  constructor(private readonly extensionPath: string) {}

  private abs(rel: string): string {
    return path.join(this.extensionPath, ...VENDOR, rel);
  }

  /** True when the vendored assets are present, i.e. offline rendering is possible. */
  get offlineCapable(): boolean {
    return fs.existsSync(this.abs("katex.min.js")) && fs.existsSync(this.abs("mermaid.min.js"));
  }

  private text(rel: string): string | null {
    const key = `t:${rel}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    try {
      const value = fs.readFileSync(this.abs(rel), "utf8");
      this.cache.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  private dataUri(rel: string, mime: string): string | null {
    const key = `d:${rel}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    try {
      const value = `data:${mime};base64,${fs.readFileSync(this.abs(rel)).toString("base64")}`;
      this.cache.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  private webviewUri(webview: vscode.Webview, rel: string): string {
    return webview.asWebviewUri(vscode.Uri.file(this.abs(rel))).toString();
  }

  /** Assets for the live preview: local files by Webview URI, jsDelivr when not vendored. */
  previewAssets(webview: vscode.Webview): TemplateAssets {
    if (!this.offlineCapable) {
      return CDN_ASSETS;
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
  exportAssets(offline: boolean): TemplateAssets {
    if (!offline || !this.offlineCapable) {
      return CDN_ASSETS;
    }
    if (!this.exportCache) {
      this.exportCache = this.buildExportAssets();
    }
    return this.exportCache;
  }

  private buildExportAssets(): TemplateAssets {
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
      ? rawKatexCss.replace(/url\(\s*fonts\/([^)\s"']+\.woff2)\s*\)/g, (whole, name: string) => {
          const uri = this.dataUri(path.posix.join("fonts", name), "font/woff2");
          return uri ? `url("${uri}")` : whole;
        })
      : null;

    // A partially vendored checkout falls back per asset rather than all-or-nothing, so
    // track whether any single fallback fired — that alone forces the CDN back into the CSP.
    let fellBack = fontCss === "" || katexCss === null;
    const inlineOr = (rel: string, fallback: AssetRef): AssetRef => {
      const body = this.text(rel);
      if (body === null) {
        fellBack = true;
        return fallback;
      }
      return { text: body };
    };

    const katexJs = inlineOr("katex.min.js", CDN_ASSETS.katexJs);
    const hljsJs = inlineOr("highlight.min.js", CDN_ASSETS.hljsJs);
    const mermaidJs = inlineOr("mermaid.min.js", CDN_ASSETS.mermaidJs);

    return {
      fontCss: fontCss || CDN_ASSETS.fontCss,
      katexCss: katexCss === null ? CDN_ASSETS.katexCss : { text: katexCss },
      katexJs,
      hljsJs,
      mermaidJs,
      usesCdn: fellBack,
    };
  }
}
