/**
 * Full HTML document shell.
 *
 * Builds the `<head>`/`<body>` wrapper around the rendered article: inlined CSS,
 * KaTeX from CDN, the Freesentation font, A4 print CSS, and the conservative
 * span-based KaTeX render script. Two modes:
 *
 *  - **preview** (`cspSource` supplied): a strict Content-Security-Policy keyed to the
 *    Webview origin, scroll persistence/restore across re-renders, bidirectional
 *    editor⇄preview scroll sync (via `data-source-line`), and a `print` message handler.
 *  - **export** (no `cspSource`): a portable standalone file. It still carries a
 *    CDN-only CSP and nonces its scripts, so an injected inline event handler cannot
 *    execute even though the file is opened outside the Webview sandbox.
 *
 * Both modes nonce every script and never enable `script-src 'unsafe-inline'`, so
 * attribute-injected `onmouseover=…` style handlers are blocked.
 */

import { escapeHtml } from "./htmlEscape";

export const KATEX_CSS_HREF = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
export const KATEX_JS_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
// highlight.js (browser bundle, ~common languages) for fenced code blocks. Loaded only
// when the article actually contains a `language-…` code block.
const HLJS_VERSION = "11.11.1";
export const HLJS_JS_SRC = `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/highlight.min.js`;
export const HLJS_CSS_HREF = `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/styles/github.min.css`;
const CDN_ORIGIN = "https://cdn.jsdelivr.net";

export interface TemplateOptions {
  title: string;
  articleHtml: string;
  /** Full stylesheet text, inlined into a `<style>` block. */
  css: string;
  /** Webview CSP source (`webview.cspSource`). Its presence selects preview mode. */
  cspSource?: string;
  /** Per-render nonce. Required in preview mode; recommended in export mode. */
  nonce?: string;
  /** Enable editor⇄preview scroll synchronization (preview mode only). Default true. */
  scrollSync?: boolean;
}

const RENDER_BODY = `
if (window.katex) {
  document.querySelectorAll('.math-tex').forEach(function (node) {
    try {
      katex.render(node.textContent, node, {
        throwOnError: false,
        displayMode: node.getAttribute('data-display') === 'true'
      });
    } catch (err) { /* leave raw LaTeX in place on failure */ }
  });
}
if (window.hljs) {
  document.querySelectorAll('pre code[class*="language-"]').forEach(function (el) {
    try { window.hljs.highlightElement(el); } catch (err) { /* unknown language: leave plain */ }
  });
}`.trim();

function previewScript(nonce: string, scrollSync: boolean): string {
  return `<script nonce="${nonce}">
(function () {
  var vscode = acquireVsCodeApi();
  var prev = vscode.getState();
  var SCROLL_SYNC = ${scrollSync ? "true" : "false"};
  var lineMap = [];            // sorted [{ line, top }] for every [data-source-line]
  var suppressPostUntil = 0;   // ignore scroll-out posts right after a programmatic scroll
  var rafPending = false;

  function buildMap() {
    lineMap = [];
    var nodes = document.querySelectorAll('[data-source-line]');
    for (var i = 0; i < nodes.length; i++) {
      var ln = parseInt(nodes[i].getAttribute('data-source-line'), 10);
      if (!isNaN(ln)) {
        lineMap.push({ line: ln, top: nodes[i].getBoundingClientRect().top + window.scrollY });
      }
    }
    lineMap.sort(function (a, b) { return a.line - b.line || a.top - b.top; });
  }

  function indexAtOrBelow(line) {
    var idx = 0;
    for (var i = 0; i < lineMap.length; i++) {
      if (lineMap[i].line <= line) { idx = i; } else { break; }
    }
    return idx;
  }

  // editor -> preview: scroll so the given source line sits at the top.
  function scrollToLine(line) {
    if (!lineMap.length) { return; }
    var idx = indexAtOrBelow(line);
    var cur = lineMap[idx];
    var target = cur.top;
    var next = lineMap[idx + 1];
    if (next && next.line > cur.line) {
      var frac = Math.max(0, Math.min(1, (line - cur.line) / (next.line - cur.line)));
      target = cur.top + (next.top - cur.top) * frac;
    }
    suppressPostUntil = Date.now() + 250;
    window.scrollTo(0, target);
  }

  // preview -> editor: which (fractional) source line is at the viewport top.
  function currentLine() {
    if (!lineMap.length) { return 0; }
    var y = window.scrollY;
    var idx = 0;
    for (var i = 0; i < lineMap.length; i++) {
      if (lineMap[i].top <= y + 1) { idx = i; } else { break; }
    }
    var cur = lineMap[idx];
    var next = lineMap[idx + 1];
    if (next && next.top > cur.top) {
      var frac = Math.max(0, Math.min(1, (y - cur.top) / (next.top - cur.top)));
      return cur.line + (next.line - cur.line) * frac;
    }
    return cur.line;
  }

  function onScroll() {
    vscode.setState({ scrollY: window.scrollY });
    if (!SCROLL_SYNC || Date.now() < suppressPostUntil || rafPending) { return; }
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      vscode.postMessage({ type: 'revealLine', line: currentLine() });
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', buildMap);
  window.addEventListener('message', function (e) {
    var msg = e.data || {};
    if (msg.type === 'scrollToLine') {
      if (!SCROLL_SYNC) { return; }
      if (!lineMap.length) { buildMap(); }
      scrollToLine(msg.line);
    } else if (msg.type === 'remap') {
      buildMap();
    }
  });

  window.addEventListener('load', function () {
    buildMap();
    if (prev && typeof prev.scrollY === 'number') {
      window.scrollTo(0, prev.scrollY);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    ${RENDER_BODY}
    buildMap();
  });
}());
</script>`;
}

function exportScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  return `<script${nonceAttr}>
document.addEventListener('DOMContentLoaded', function () {
  ${RENDER_BODY}
});
</script>`;
}

function previewCsp(cspSource: string, nonce: string): string {
  return (
    "default-src 'none'; " +
    `img-src ${cspSource} https: data: blob:; ` +
    `style-src ${cspSource} ${CDN_ORIGIN} 'unsafe-inline'; ` +
    `font-src ${cspSource} ${CDN_ORIGIN} data:; ` +
    `script-src 'nonce-${nonce}' ${CDN_ORIGIN};`
  );
}

function exportCsp(nonce: string): string {
  return (
    "default-src 'none'; " +
    "img-src https: data:; " +
    `style-src 'unsafe-inline' ${CDN_ORIGIN}; ` +
    `font-src ${CDN_ORIGIN} data:; ` +
    `script-src 'nonce-${nonce}' ${CDN_ORIGIN};`
  );
}

export function buildHtmlDocument(options: TemplateOptions): string {
  const { title, articleHtml, css, cspSource, nonce, scrollSync = true } = options;
  const isPreview = Boolean(cspSource);

  let csp = "";
  if (isPreview && nonce) {
    csp = previewCsp(cspSource as string, nonce);
  } else if (nonce) {
    csp = exportCsp(nonce);
  }
  const cspMeta = csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` : "";

  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const katexScript = `<script defer${nonceAttr} src="${KATEX_JS_SRC}"></script>`;
  const renderScript = isPreview ? previewScript(nonce as string, scrollSync) : exportScript(nonce);

  // Load highlight.js only when a fenced code block with a language is present. The
  // theme link precedes the inlined <style> so preview.css can override its background.
  const hasCode = articleHtml.includes('class="language-');
  const hljsCss = hasCode ? `<link rel="stylesheet" href="${HLJS_CSS_HREF}">\n` : "";
  const hljsScript = hasCode ? `\n<script defer${nonceAttr} src="${HLJS_JS_SRC}"></script>` : "";

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta}<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${KATEX_CSS_HREF}">
${hljsCss}<style>
${css}
</style>
${katexScript}${hljsScript}
${renderScript}
</head>
<body>
<main>
<article>
${articleHtml}
</article>
</main>
</body>
</html>
`;
}
