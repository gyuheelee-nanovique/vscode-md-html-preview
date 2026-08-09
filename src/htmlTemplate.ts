/**
 * Full HTML document shell.
 *
 * Builds the `<head>`/`<body>` wrapper around the rendered article: inlined CSS,
 * KaTeX / highlight.js / Mermaid, the Freesentation font, A4 print CSS, and one unified
 * client script. Where those third-party assets come from — extension-local files, inlined
 * text, or the CDN — is decided by the caller and arrives in `options.assets`
 * (see `src/assets.ts`); this module only decides how to emit them.
 *
 * The client script is shared by both modes and drives:
 *  - KaTeX / highlight.js / Mermaid rendering (RENDER_BODY),
 *  - theme (light/dark) and view mode (document/slide), persisted per document,
 *  - slide pagination on `---`, click-half + arrow-key navigation,
 *  - a right-click settings menu (theme + mode),
 *  - auto-hiding scrollbars,
 *  - and, in **preview** mode only, bidirectional editor⇄preview scroll sync.
 *
 * Two CSP profiles: **preview** (`cspSource` supplied) keys the policy to the Webview
 * origin; **export** (no `cspSource`) is a portable standalone file. Either widens to the
 * CDN origin only when the assets actually come from there. Both nonce every script and
 * never enable `script-src 'unsafe-inline'`.
 */

import { escapeHtml } from "./htmlEscape";

export const KATEX_CSS_HREF = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
export const KATEX_JS_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
// highlight.js (browser bundle, ~common languages) for fenced code blocks. Loaded only
// when the article actually contains a `language-…` code block.
const HLJS_VERSION = "11.11.1";
export const HLJS_JS_SRC = `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/highlight.min.js`;
// Token colours come from preview.css (theme-aware) — no stock hljs theme stylesheet.
// Mermaid (UMD browser bundle) for `<pre class="mermaid">` diagrams. Loaded only when the
// article actually contains a mermaid block. jsdelivr is already the allowed CDN_ORIGIN, so
// no CSP change is needed for the script; mermaid injects its own <style> at runtime, which
// style-src 'unsafe-inline' already permits.
export const MERMAID_JS_SRC = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
const CDN_ORIGIN = "https://cdn.jsdelivr.net";

export type PreviewTheme = "light" | "dark";
export type PreviewMode = "document" | "slide";

/** One third-party asset: either linked by URL (`href`) or inlined verbatim (`text`). */
export type AssetRef = { href: string; text?: undefined } | { text: string; href?: undefined };

export interface TemplateAssets {
  /** `@font-face` rules for the 'Presentation' family (URLs vary per target). */
  fontCss: string;
  katexCss: AssetRef;
  katexJs: AssetRef;
  hljsJs: AssetRef;
  mermaidJs: AssetRef;
  /** True when any of the above still points at the CDN, so the CSP must allow it. */
  usesCdn: boolean;
}

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
  /** Theme baked into `<html data-theme>` before the client's persisted choice loads. */
  theme?: PreviewTheme;
  /** View mode baked into `<html data-mode>` before the client's persisted choice loads. */
  mode?: PreviewMode;
  /** Where KaTeX / highlight.js / Mermaid / the webfont come from. Defaults to the CDN. */
  assets?: TemplateAssets;
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
}
// Mermaid is handled separately by runMermaid() in the client script so its colours can
// track the active theme and re-render on a theme toggle (see below).`.trim();

/**
 * The unified client bootstrap. `IS_PREVIEW` selects the state backend (VS Code webview
 * state vs. localStorage) and whether scroll-sync runs. Written with string concatenation
 * (no template literals / backticks) so it can be embedded in this module's own template
 * string without `${…}` collisions.
 */
function clientScript(isPreview: boolean, nonce: string, scrollSync: boolean): string {
  return `<script nonce="${nonce}">
(function () {
  "use strict";
  var IS_PREVIEW = ${isPreview ? "true" : "false"};
  var SCROLL_SYNC = ${scrollSync ? "true" : "false"};

  var vscode = null;
  if (IS_PREVIEW) { try { vscode = acquireVsCodeApi(); } catch (e) { vscode = null; } }

  var root = document.documentElement;

  // ---- persistent state (merge semantics; never clobber sibling keys) ----
  function readState() {
    if (vscode) { return vscode.getState() || {}; }
    try { return JSON.parse(localStorage.getItem('mdhtml.ui') || '{}'); } catch (e) { return {}; }
  }
  function writeState(patch) {
    var s = readState();
    for (var k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k]; }
    if (vscode) { try { vscode.setState(s); } catch (e) {} }
    else { try { localStorage.setItem('mdhtml.ui', JSON.stringify(s)); } catch (e) {} }
  }
  function post(msg) { if (vscode) { try { vscode.postMessage(msg); } catch (e) {} } }

  var st = readState();
  var theme = (st.theme === 'light' || st.theme === 'dark')
    ? st.theme : (root.getAttribute('data-theme') || 'dark');
  var mode = (st.mode === 'slide') ? 'slide' : (root.getAttribute('data-mode') || 'document');
  var slideIndex = (typeof st.slideIndex === 'number') ? st.slideIndex : 0;

  // ---- theme ----
  function applyTheme(t) {
    theme = (t === 'light' || t === 'dark') ? t : 'dark';
    root.setAttribute('data-theme', theme);
    writeState({ theme: theme });
    syncMenu();
    runMermaid(afterRender); // recolour diagrams for the new theme (+ refresh deck/line map)
  }
  function toggleTheme() { applyTheme(theme === 'dark' ? 'light' : 'dark'); }

  // ---- Mermaid: palette derived from the active theme, re-rendered on theme change ----
  var mermaidStashed = false;
  function mermaidThemeVars() {
    var cs = getComputedStyle(root);
    function v(name, fb) { var x = (cs.getPropertyValue(name) || '').trim(); return x || fb; }
    var bg = v('--bg', '#ffffff'), ink = v('--ink', '#111111'), soft = v('--soft', '#eeeeee'),
        line = v('--line', '#cccccc'), muted = v('--muted', '#666666'),
        accent = v('--accent', '#cf4520'), heading = v('--heading', ink);
    // Diagrams share the page's warm palette in both modes: cream/warm-dark node fills,
    // vermilion borders (same accent as inline code and block-quotes), and arrows in the
    // muted tone so they stay clearly visible on the dark background.
    return {
      background: bg,
      mainBkg: soft, primaryColor: soft, secondaryColor: bg, tertiaryColor: bg,
      primaryTextColor: ink, secondaryTextColor: ink, tertiaryTextColor: ink,
      textColor: ink, nodeTextColor: ink, titleColor: heading,
      primaryBorderColor: accent, nodeBorder: accent,
      secondaryBorderColor: line, tertiaryBorderColor: line,
      clusterBkg: bg, clusterBorder: line,
      lineColor: muted, edgeLabelBackground: bg,
      fontFamily: "'Presentation', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    };
  }
  function runMermaid(done) {
    if (!window.mermaid) { if (done) done(); return; }
    var nodes = document.querySelectorAll('pre.mermaid');
    if (!nodes.length) { if (done) done(); return; }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // Stash the raw source on the first run and restore it on every re-run: Mermaid
      // replaces the element's text with an <svg>, so re-theming needs the original source.
      if (!mermaidStashed) el.setAttribute('data-src', el.textContent);
      else el.textContent = el.getAttribute('data-src') || el.textContent;
      el.removeAttribute('data-processed');
    }
    mermaidStashed = true;
    try {
      window.mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        themeVariables: mermaidThemeVars()
      });
      Promise.resolve(window.mermaid.run({ nodes: Array.prototype.slice.call(nodes) }))
        .then(function () { themeDiagrams(); if (done) done(); },
              function () { if (done) done(); });
    } catch (e) { if (done) done(); }
  }
  // Repaint every diagram in the page palette. Mermaid writes a document's own
  // 'classDef … fill:#e3f2fd' as an INLINE style with !important, which no stylesheet rule
  // can outrank — the only way to win is to re-set the property on that same inline
  // declaration, which is what setProperty(..., 'important') does here. Runs after each
  // render (including the re-render on a theme toggle), so decks keep one tone throughout.
  function themeDiagrams() {
    var cs = getComputedStyle(root);
    function v(name, fb) { var x = (cs.getPropertyValue(name) || '').trim(); return x || fb; }
    var soft = v('--soft', '#eeeeee'), accent = v('--accent', '#cf4520'),
        ink = v('--ink', '#111111'), bg = v('--bg', '#ffffff'),
        line = v('--line', '#cccccc'), muted = v('--muted', '#666666');
    function force(el, prop, val) { try { el.style.setProperty(prop, val, 'important'); } catch (e) {} }
    function paint(scope, sel, props) {
      var els = scope.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        for (var k = 0; k < props.length; k++) force(els[i], props[k][0], props[k][1]);
      }
    }
    var diagrams = document.querySelectorAll('pre.mermaid');
    for (var d = 0; d < diagrams.length; d++) {
      var m = diagrams[d];
      paint(m, '.node rect, .node polygon, .node circle, .node ellipse, .node path',
            [['fill', soft], ['stroke', accent]]);
      paint(m, '.cluster rect', [['fill', bg], ['stroke', line]]);
      paint(m, '.nodeLabel, .nodeLabel *, .node text, .node tspan, .cluster-label, .cluster-label *',
            [['color', ink], ['fill', ink]]);
      paint(m, '.edgePath path, .flowchart-link', [['stroke', muted]]);
      paint(m, 'marker path', [['fill', muted], ['stroke', muted]]);
    }
  }
  // After (re-)rendering diagrams: refresh the scroll-sync line map and, in slide mode,
  // rebuild the deck so it clones the freshly rendered SVGs.
  function afterRender() { buildMap(); if (mode === 'slide') buildDeck(); }

  // ---- auto-hiding scrollbar (thumb tinted only while the element scrolls) ----
  function autoHide(el) {
    var timer = null;
    var target = (el === window) ? document.body : el;
    el.addEventListener('scroll', function () {
      target.classList.add('scrolling');
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { target.classList.remove('scrolling'); }, 700);
    }, { passive: true });
  }

  // ---- slides ----
  var deck = null, slides = [], slideLines = [];
  function teardownDeck() {
    if (deck && deck.parentNode) deck.parentNode.removeChild(deck);
    deck = null; slides = [];
  }
  function buildDeck() {
    teardownDeck();
    var article = document.querySelector('article');
    if (!article) return;
    deck = document.createElement('div');
    deck.className = 'deck';
    var current = document.createElement('section');
    current.className = 'slide';
    var kids = Array.prototype.slice.call(article.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      var isSep = node.nodeType === 1 && node.classList && node.classList.contains('slide-sep');
      if (isSep) {
        deck.appendChild(current);
        current = document.createElement('section');
        current.className = 'slide';
      } else {
        current.appendChild(node.cloneNode(true));
      }
    }
    deck.appendChild(current);
    // Drop empty sections (e.g. a leading/trailing '---' or consecutive separators).
    var all = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
    slides = all.filter(function (s) {
      return s.textContent.trim().length > 0 || s.querySelector('img, svg, table');
    });
    deck.innerHTML = '';
    for (var j = 0; j < slides.length; j++) deck.appendChild(slides[j]);
    if (!slides.length) { // no real content — keep one empty slide so the deck isn't blank
      var only = document.createElement('section');
      only.className = 'slide';
      deck.appendChild(only);
      slides = [only];
    }
    document.body.appendChild(deck);
    for (var k = 0; k < slides.length; k++) autoHide(slides[k]);
    // Map each slide to its source-line range for editor⇄preview slide sync: start = the
    // slide's smallest data-source-line; heading = its first H1–H6 line (else the start).
    slideLines = slides.map(function (sec) {
      var withLine = sec.querySelectorAll('[data-source-line]');
      var start = Infinity, heading = null;
      for (var q = 0; q < withLine.length; q++) {
        var ln = parseInt(withLine[q].getAttribute('data-source-line'), 10);
        if (isNaN(ln)) continue;
        if (ln < start) start = ln;
        if (heading === null && /^H[1-6]$/.test(withLine[q].tagName)) heading = ln;
      }
      if (start === Infinity) start = 0;
      return { start: start, heading: heading === null ? start : heading };
    });
    if (slideIndex >= slides.length) slideIndex = slides.length - 1;
    if (slideIndex < 0) slideIndex = 0;
    showSlide(slideIndex);
  }
  function showSlide(i) {
    if (!slides.length) return;
    slideIndex = Math.max(0, Math.min(slides.length - 1, i));
    for (var n = 0; n < slides.length; n++) {
      slides[n].classList.toggle('active', n === slideIndex);
    }
    writeState({ slideIndex: slideIndex });
    if (slides[slideIndex]) slides[slideIndex].scrollTop = 0;
  }
  // Preview → editor (slide mode): centre the current slide's heading line in the editor.
  function postSlideToEditor() {
    if (!IS_PREVIEW || !SCROLL_SYNC || !slideLines.length) return;
    var s = slideLines[slideIndex];
    if (s) post({ type: 'revealLine', line: s.heading });
  }
  // User navigation shows the slide AND syncs the editor; editor-driven changes stay silent.
  function gotoSlide(i) { showSlide(i); postSlideToEditor(); }
  function nextSlide() { gotoSlide(slideIndex + 1); }
  function prevSlide() { gotoSlide(slideIndex - 1); }
  // Editor → preview (slide mode): show the slide whose source range holds the given line.
  function activateSlideForLine(line) {
    if (!slideLines.length) return;
    var idx = 0;
    for (var i = 0; i < slideLines.length; i++) {
      if (slideLines[i].start <= line) idx = i; else break;
    }
    if (idx !== slideIndex) showSlide(idx);
  }

  // ---- view mode ----
  function applyMode(m) {
    mode = (m === 'slide') ? 'slide' : 'document';
    root.setAttribute('data-mode', mode);
    if (mode === 'slide') buildDeck(); else teardownDeck();
    writeState({ mode: mode });
    syncMenu();
  }
  function toggleMode() { applyMode(mode === 'slide' ? 'document' : 'slide'); }

  // ---- edge-click navigation (slide mode only) ----
  // Only the outer 10% strips navigate; the middle 80% is inert so selecting text or
  // annotating (e.g. iPad handwriting) never advances the slide by accident.
  var EDGE_RATIO = 0.10;
  document.addEventListener('click', function (e) {
    if (mode !== 'slide') return;
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('.ui-menu')) return; // menu click, not nav
    if (e.target.closest && e.target.closest('a')) return;        // let links work
    var sel = window.getSelection && window.getSelection();
    if (sel && sel.toString().length > 0) return;                 // don't nav on text select
    var w = window.innerWidth;
    var edge = w * EDGE_RATIO;
    if (e.clientX <= edge) prevSlide();
    else if (e.clientX >= w - edge) nextSlide();
    // middle 80%: no navigation
  });

  // ---- keyboard ----
  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape' && menuEl) { closeMenu(); return; }
    if (mode !== 'slide') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { nextSlide(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prevSlide(); e.preventDefault(); }
    else if (e.key === 'Home') { gotoSlide(0); e.preventDefault(); }
    else if (e.key === 'End') { gotoSlide(slides.length - 1); e.preventDefault(); }
  });

  // ---- right-click settings menu ----
  var menuEl = null;
  function closeMenu() { if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; }
  function syncMenu() {
    if (!menuEl) return;
    var items = menuEl.querySelectorAll('[data-val]');
    for (var i = 0; i < items.length; i++) {
      var g = items[i].getAttribute('data-group');
      var v = items[i].getAttribute('data-val');
      var on = (g === 'theme' && v === theme) || (g === 'mode' && v === mode);
      items[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  function menuItem(group, val, label) {
    return '<button class="ui-menu-item" role="menuitemradio" data-group="' + group +
      '" data-val="' + val + '">' + label + '</button>';
  }
  function menuAction(act, label) {
    return '<button class="ui-menu-item" role="menuitem" data-act="' + act + '">' + label + '</button>';
  }
  function openMenu(x, y) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'ui-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML =
      '<div class="ui-menu-label">테마</div>' +
      menuItem('theme', 'light', '라이트') +
      menuItem('theme', 'dark', '다크') +
      '<div class="ui-menu-sep"></div>' +
      '<div class="ui-menu-label">모드</div>' +
      menuItem('mode', 'document', '문서') +
      menuItem('mode', 'slide', '슬라이드') +
      // Commands need the extension host, so they only exist in the preview — an already
      // exported file has nothing to post to.
      (IS_PREVIEW
        ? '<div class="ui-menu-sep"></div>' +
          '<div class="ui-menu-label">내보내기</div>' +
          menuAction('exportHtml', 'HTML로 저장…') +
          menuAction('print', '인쇄 / PDF로 저장…')
        : '');
    document.body.appendChild(menuEl);
    var w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    menuEl.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menuEl.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 8)) + 'px';
    menuEl.addEventListener('click', function (ev) {
      var act = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (act) { post({ type: act.getAttribute('data-act') }); closeMenu(); return; }
      var it = ev.target.closest ? ev.target.closest('[data-val]') : null;
      if (!it) return;
      var g = it.getAttribute('data-group'), v = it.getAttribute('data-val');
      if (g === 'theme') applyTheme(v); else if (g === 'mode') applyMode(v);
      closeMenu();
    });
    syncMenu();
  }
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); openMenu(e.clientX, e.clientY); });
  document.addEventListener('click', function (e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }, true);
  window.addEventListener('resize', function () { closeMenu(); });

  // ================= scroll sync (preview + document mode only) =================
  var lineMap = [];
  var suppressPostUntil = 0;
  var rafPending = false;
  // Each entry is a block's source-line span [s, e] and its pixel span [top, bottom].
  function buildMap() {
    lineMap = [];
    var nodes = document.querySelectorAll('[data-source-line]');
    for (var i = 0; i < nodes.length; i++) {
      var s = parseInt(nodes[i].getAttribute('data-source-line'), 10);
      if (isNaN(s)) continue;
      var e = parseInt(nodes[i].getAttribute('data-source-line-end'), 10);
      if (isNaN(e) || e < s) e = s;
      var r = nodes[i].getBoundingClientRect();
      lineMap.push({ s: s, e: e, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY });
    }
    lineMap.sort(function (a, b) { return a.top - b.top; });
  }
  // A source line → preview Y. Inside a block: interpolate by the block's own pixel span, so
  // a tall block (image/Mermaid) or a short one maps accurately. In a gap between blocks
  // (blank/comment lines that render to nothing): pin to the previous block's bottom — a dead
  // zone the preview doesn't drift across.
  function pixelForLine(line) {
    var prev = null;
    for (var i = 0; i < lineMap.length; i++) {
      var b = lineMap[i];
      if (line < b.s) return prev ? prev.bottom : b.top;
      if (line <= b.e) {
        var span = b.e - b.s;
        var frac = span > 0 ? (line - b.s) / span : 0;
        return b.top + frac * (b.bottom - b.top);
      }
      prev = b;
    }
    return prev ? prev.bottom : 0;
  }
  // Editor -> preview: place that source line at the viewport's vertical CENTRE.
  function scrollToLine(line) {
    if (!lineMap.length) return;
    suppressPostUntil = Date.now() + 250;
    window.scrollTo(0, pixelForLine(line) - window.innerHeight / 2);
  }
  // Preview -> editor: the source line at the viewport's vertical CENTRE. Inside a block:
  // interpolate by pixel fraction; in a gap: report the previous block's last line.
  function currentLine() {
    if (!lineMap.length) return 0;
    var y = window.scrollY + window.innerHeight / 2;
    var prev = null;
    for (var i = 0; i < lineMap.length; i++) {
      var b = lineMap[i];
      if (y < b.top) return prev ? prev.e : b.s;
      if (y <= b.bottom) {
        var pspan = b.bottom - b.top;
        var frac = pspan > 0 ? (y - b.top) / pspan : 0;
        return b.s + frac * (b.e - b.s);
      }
      prev = b;
    }
    return prev ? prev.e : 0;
  }
  function onScroll() {
    writeState({ scrollY: window.scrollY });
    if (!IS_PREVIEW || !SCROLL_SYNC || mode === 'slide') return;
    if (Date.now() < suppressPostUntil || rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      post({ type: 'revealLine', line: currentLine() });
    });
  }

  // ---- host → webview messages ----
  window.addEventListener('message', function (e) {
    var msg = e.data || {};
    if (msg.type === 'scrollToLine') {
      if (!IS_PREVIEW || !SCROLL_SYNC) return;
      if (mode === 'slide') { activateSlideForLine(msg.line); return; }
      if (!lineMap.length) buildMap();
      scrollToLine(msg.line);
    } else if (msg.type === 'setTheme') {
      applyTheme(msg.theme === 'toggle' ? (theme === 'dark' ? 'light' : 'dark') : msg.theme);
    } else if (msg.type === 'setMode') {
      applyMode(msg.mode === 'toggle' ? (mode === 'slide' ? 'document' : 'slide') : msg.mode);
    }
  });

  // ---- init ----
  function init() {
    ${RENDER_BODY}
    root.setAttribute('data-theme', theme);
    autoHide(window);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', buildMap);
    applyMode(mode); // builds the deck when starting in slide mode
    runMermaid(afterRender); // render diagrams in the active theme, then refresh deck/map
    buildMap();
    if (mode === 'document') {
      var prev = readState();
      if (prev && typeof prev.scrollY === 'number') window.scrollTo(0, prev.scrollY);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
</script>`;
}

/** The CDN origin, listed only when an asset still comes from there. */
function cdn(usesCdn: boolean): string {
  return usesCdn ? ` ${CDN_ORIGIN}` : "";
}

function previewCsp(cspSource: string, nonce: string, usesCdn: boolean): string {
  return (
    "default-src 'none'; " +
    `img-src ${cspSource} https: data: blob:; ` +
    `style-src ${cspSource}${cdn(usesCdn)} 'unsafe-inline'; ` +
    `font-src ${cspSource}${cdn(usesCdn)} data:; ` +
    `script-src 'nonce-${nonce}'${cdn(usesCdn)};`
  );
}

/**
 * Standalone files carry everything they need inline, so the offline policy grants no
 * network origin at all beyond images (a document may legitimately reference remote ones).
 */
function exportCsp(nonce: string, usesCdn: boolean): string {
  return (
    "default-src 'none'; " +
    "img-src https: data:; " +
    `style-src 'unsafe-inline'${cdn(usesCdn)}; ` +
    `font-src data:${cdn(usesCdn)}; ` +
    `script-src 'nonce-${nonce}'${cdn(usesCdn)};`
  );
}

/** jsDelivr URLs, used when `media/vendor/` was never populated (see src/assets.ts). */
export const CDN_ASSETS: TemplateAssets = {
  fontCss: [
    ["Freesentation-4Regular.woff2", 400],
    ["Freesentation-7Bold.woff2", 700],
  ]
    .map(
      ([file, weight]) =>
        `@font-face{font-family:'Presentation';src:url("${CDN_ORIGIN}/gh/projectnoonnu/2404@1.0/${file}") ` +
        `format('woff2');font-weight:${weight};font-style:normal;font-display:swap}`
    )
    .join("\n"),
  katexCss: { href: KATEX_CSS_HREF },
  katexJs: { href: KATEX_JS_SRC },
  hljsJs: { href: HLJS_JS_SRC },
  mermaidJs: { href: MERMAID_JS_SRC },
  usesCdn: true,
};

/**
 * `</script` / `</style` inside a bundle's own string literals would end the tag early.
 * Neither current bundle contains one, but a future version might, and the escape is inert
 * everywhere else.
 */
function escapeForTag(body: string, tag: "script" | "style"): string {
  return body.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

function styleTag(ref: AssetRef, nonceAttr: string): string {
  return ref.text !== undefined
    ? `<style${nonceAttr}>\n${escapeForTag(ref.text, "style")}\n</style>`
    : `<link rel="stylesheet"${nonceAttr} href="${ref.href}">`;
}

/**
 * Inlined bundles are emitted WITHOUT `defer` — a classic inline script runs the moment it
 * is parsed, which is still before the client script's DOMContentLoaded init, so
 * window.katex / hljs / mermaid are ready either way.
 */
function scriptTag(ref: AssetRef, nonceAttr: string): string {
  return ref.text !== undefined
    ? `<script${nonceAttr}>\n${escapeForTag(ref.text, "script")}\n</script>`
    : `<script defer${nonceAttr} src="${ref.href}"></script>`;
}

export function buildHtmlDocument(options: TemplateOptions): string {
  const {
    title,
    articleHtml,
    css,
    cspSource,
    nonce,
    scrollSync = true,
    theme = "dark",
    mode = "document",
    assets = CDN_ASSETS,
  } = options;
  const isPreview = Boolean(cspSource);

  let csp = "";
  if (isPreview && nonce) {
    csp = previewCsp(cspSource as string, nonce, assets.usesCdn);
  } else if (nonce) {
    csp = exportCsp(nonce, assets.usesCdn);
  }
  const cspMeta = csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` : "";

  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  const katexScript = scriptTag(assets.katexJs, nonceAttr);
  const renderScript = clientScript(isPreview, nonce ?? "", scrollSync);

  // Load highlight.js only when a fenced code block with a language is present. Token COLORS
  // come from preview.css (theme-aware, light/dark) — we deliberately do NOT load a stock
  // hljs theme stylesheet, whose fixed light palette was invisible on the dark background.
  const hasCode = articleHtml.includes('class="language-');
  const hljsScript = hasCode ? `\n${scriptTag(assets.hljsJs, nonceAttr)}` : "";

  // Load Mermaid only when a `<pre class="mermaid">` diagram is present — it is by far the
  // largest asset (~3.5 MB), so keeping it out of diagram-free exports matters. Mermaid
  // injects its own <style> at runtime, which style-src 'unsafe-inline' already permits.
  const hasMermaid = articleHtml.includes('class="mermaid"');
  const mermaidScript = hasMermaid ? `\n${scriptTag(assets.mermaidJs, nonceAttr)}` : "";

  return `<!doctype html>
<html lang="ko" data-theme="${theme}" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta}<title>${escapeHtml(title)}</title>
${styleTag(assets.katexCss, nonceAttr)}
<style${nonceAttr}>
${assets.fontCss}
${css}
</style>
${katexScript}${hljsScript}${mermaidScript}
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
