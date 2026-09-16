"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDN_ASSETS = exports.MERMAID_JS_SRC = exports.HLJS_JS_SRC = exports.KATEX_JS_SRC = exports.KATEX_CSS_HREF = void 0;
exports.buildHtmlDocument = buildHtmlDocument;
const htmlEscape_1 = require("./htmlEscape");
exports.KATEX_CSS_HREF = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
exports.KATEX_JS_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
// highlight.js (browser bundle, ~common languages) for fenced code blocks. Loaded only
// when the article actually contains a `language-…` code block.
const HLJS_VERSION = "11.11.1";
exports.HLJS_JS_SRC = `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/highlight.min.js`;
// Token colours come from preview.css (theme-aware) — no stock hljs theme stylesheet.
// Mermaid (UMD browser bundle) for `<pre class="mermaid">` diagrams. Loaded only when the
// article actually contains a mermaid block. jsdelivr is already the allowed CDN_ORIGIN, so
// no CSP change is needed for the script; mermaid injects its own <style> at runtime, which
// style-src 'unsafe-inline' already permits.
exports.MERMAID_JS_SRC = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";
const CDN_ORIGIN = "https://cdn.jsdelivr.net";
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
function clientScript(isPreview, nonce, scrollSync, printFrames) {
    return `<script nonce="${nonce}">
(function () {
  "use strict";
  var IS_PREVIEW = ${isPreview ? "true" : "false"};
  var SCROLL_SYNC = ${scrollSync ? "true" : "false"};
  var PRINT_FRAMES = ${printFrames ? "true" : "false"};
  var FRAMES_CSS = ${JSON.stringify(framesCss())};
  // One lecture-video frame in CSS px: render_slide_pngs.js lays the deck out at
  // 1280x720 / zoom 1.5 = 853.33x480 and rasterises at deviceScaleFactor 4.5 -> 3840x2160.
  var FRAME_W = 2560 / 3, FRAME_H = 480;
  // How long after a (re)load the preview stays quiet towards the editor: images decode,
  // Mermaid renders and the anchor is re-applied inside this window, and any of those emits
  // scroll events that must NOT be reported as the user scrolling.
  var SETTLE_MS = 800;

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
  // Source line to centre on after this (re)load: the editor's centre line stamped by the
  // extension wins; the line the preview itself last showed is the fallback.
  var anchorAttr = parseInt(root.getAttribute('data-anchor-line') || '', 10);
  var anchorLine = !isNaN(anchorAttr) ? anchorAttr
    : (typeof st.anchorLine === 'number' ? st.anchorLine : null);
  var userScrolled = false; // set by wheel/touch/keys — after that the anchor is not re-applied
  var slideScroll = (st.slideScroll && typeof st.slideScroll === 'object') ? st.slideScroll : {};
  var mermaidH = (st.mermaidH && typeof st.mermaidH === 'object') ? st.mermaidH : {};
  if (PRINT_FRAMES) mode = 'slide';

  // ---- theme ----
  function applyTheme(t) {
    theme = (t === 'light' || t === 'dark') ? t : 'dark';
    root.setAttribute('data-theme', theme);
    writeState({ theme: theme });
    post({ type: 'uiState', mode: mode, theme: theme });
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
      // Reserve the height this diagram had last time (keyed by its source) so the blocks
      // below it do not jump when the SVG arrives — the same layout-shift the lazy images had.
      var known = mermaidH[hashStr(el.getAttribute('data-src') || '')];
      if (typeof known === 'number' && known > 0) el.style.minHeight = known + 'px';
    }
    mermaidStashed = true;
    var remember = function () {
      var changed = false;
      for (var q = 0; q < nodes.length; q++) {
        var h = nodes[q].offsetHeight, key = hashStr(nodes[q].getAttribute('data-src') || '');
        if (h > 0 && mermaidH[key] !== h) { mermaidH[key] = h; changed = true; }
      }
      if (changed) writeState({ mermaidH: mermaidH });
    };
    try {
      window.mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        themeVariables: mermaidThemeVars()
      });
      // Wait for webfonts before rendering. Mermaid sizes each node box from a measurement
      // of its label, and at DOMContentLoaded the 'Presentation' face is not there yet — the
      // fallback measures CJK wider, so the box comes out too big and the glyphs, drawn later
      // in the real face, sit left with all the slack on the right (measured: box 255 /
      // label 195 / ink 154 -> padding 30 left, 70 right; after fonts, 214 / 154 / 154 ->
      // 30 / 30). The same over-measure pushes a label past wrappingWidth and adds a phantom
      // line. Fonts are inlined as base64 here, so the wait costs essentially nothing.
      var fontsReady = (document.fonts && document.fonts.ready) || Promise.resolve();
      Promise.resolve(fontsReady).catch(function () {})
        .then(function () { return window.mermaid.run({ nodes: Array.prototype.slice.call(nodes) }); })
        .then(function () { themeDiagrams(); remember(); if (done) done(); },
              function () { if (done) done(); });
    } catch (e) { if (done) done(); }
  }
  // Small stable string hash (djb2) for the per-diagram height cache.
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'm' + (h >>> 0).toString(36);
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
  function afterRender() {
    if (PRINT_FRAMES) { buildFrames(); return; }
    buildMap();
    if (mode === 'slide') buildDeck();
    settle();
    restoreAnchor();
  }

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
    for (var k = 0; k < slides.length; k++) {
      autoHide(slides[k]);
      (function (idx, el) {
        el.addEventListener('scroll', function () {
          slideScroll[String(idx)] = el.scrollTop;
          writeState({ slideScroll: slideScroll });
        }, { passive: true });
      })(k, slides[k]);
    }
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
    var el = slides[slideIndex];
    if (el) {
      // A re-render rebuilds the deck: put the slide back where it was scrolled (the state
      // is cleared by gotoSlide, so user navigation still starts each slide at the top).
      var keep = slideScroll[String(slideIndex)];
      el.scrollTop = (typeof keep === 'number') ? keep : 0;
    }
  }
  // Preview → editor (slide mode): centre the current slide's heading line in the editor.
  function postSlideToEditor() {
    if (!IS_PREVIEW || !SCROLL_SYNC || !slideLines.length) return;
    var s = slideLines[slideIndex];
    if (s) post({ type: 'revealLine', line: s.heading });
  }
  // User navigation shows the slide AND syncs the editor; editor-driven changes stay silent.
  function gotoSlide(i) { slideScroll = {}; writeState({ slideScroll: slideScroll }); showSlide(i); postSlideToEditor(); }
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
    if (PRINT_FRAMES) return; // the frames layout is a fixed slide view
    mode = (m === 'slide') ? 'slide' : 'document';
    root.setAttribute('data-mode', mode);
    if (mode === 'slide') buildDeck(); else teardownDeck();
    writeState({ mode: mode });
    post({ type: 'uiState', mode: mode, theme: theme });
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
          menuAction('print', '인쇄 / PDF로 저장…') +
          menuAction('printSlides', '16:9 슬라이드(영상 프레임) PDF…')
        : (PRINT_FRAMES ? '' :
          '<div class="ui-menu-sep"></div>' +
          '<div class="ui-menu-label">인쇄</div>' +
          menuAction('enterFrames', '16:9 슬라이드(영상 프레임) 레이아웃으로')));
    document.body.appendChild(menuEl);
    var w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    menuEl.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menuEl.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 8)) + 'px';
    menuEl.addEventListener('click', function (ev) {
      var act = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (act) {
        var name = act.getAttribute('data-act');
        if (name === 'enterFrames') enterFrames(); else post({ type: name });
        closeMenu();
        return;
      }
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
  // Quiet window towards the editor (see SETTLE_MS). Extended, never shortened.
  function settle() { suppressPostUntil = Math.max(suppressPostUntil, Date.now() + SETTLE_MS); }
  // True once every image has its final box — before that the line map is wrong below them.
  function imagesSettled() {
    var imgs = document.images;
    for (var i = 0; i < imgs.length; i++) { if (!imgs[i].complete) return false; }
    return true;
  }
  // Re-centre the anchor line unless the user has taken over the scroll position.
  function restoreAnchor() {
    if (!IS_PREVIEW || !SCROLL_SYNC || mode !== 'document') return;
    if (userScrolled || anchorLine === null) return;
    buildMap();
    scrollToLine(anchorLine);
  }
  // Each image that is still loading re-applies the anchor once its box is known.
  function watchImages() {
    var imgs = document.images;
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete) continue;
      imgs[i].addEventListener('load', function () { settle(); buildMap(); restoreAnchor(); }, { once: true });
      imgs[i].addEventListener('error', function () { settle(); buildMap(); }, { once: true });
    }
  }
  function markUserScroll() { userScrolled = true; }
  window.addEventListener('wheel', markUserScroll, { passive: true });
  window.addEventListener('touchmove', markUserScroll, { passive: true });
  window.addEventListener('keydown', function (e) {
    if (mode !== 'document') return;
    if (/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/.test(e.key)) userScrolled = true;
  });
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
    suppressPostUntil = Math.max(suppressPostUntil, Date.now() + 250);
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
    if (!IS_PREVIEW || !SCROLL_SYNC || mode === 'slide') { writeState({ scrollY: window.scrollY }); return; }
    // Only a scroll the user made moves the anchor; layout shifts and our own re-centring
    // never do (they would otherwise be reported back as a new position — the editor jump).
    if (Date.now() < suppressPostUntil || rafPending || !imagesSettled()) {
      writeState({ scrollY: window.scrollY });
      return;
    }
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      var line = currentLine();
      anchorLine = line;
      writeState({ scrollY: window.scrollY, anchorLine: line });
      post({ type: 'revealLine', line: line });
    });
  }

  // ---- host → webview messages ----
  window.addEventListener('message', function (e) {
    var msg = e.data || {};
    if (msg.type === 'scrollToLine') {
      if (!IS_PREVIEW || !SCROLL_SYNC) return;
      anchorLine = msg.line; userScrolled = false;
      writeState({ anchorLine: msg.line });
      if (mode === 'slide') { activateSlideForLine(msg.line); return; }
      if (!lineMap.length) buildMap();
      scrollToLine(msg.line);
    } else if (msg.type === 'queryState') {
      // The extension asks right before printing: answer with the live mode/theme so the
      // decision never depends on an earlier message having been seen.
      post({ type: 'uiState', mode: mode, theme: theme, reply: true });
    } else if (msg.type === 'update') {
      if (typeof msg.articleHtml === 'string') applyUpdate(msg.articleHtml, msg.anchorLine);
    } else if (msg.type === 'setTheme') {
      applyTheme(msg.theme === 'toggle' ? (theme === 'dark' ? 'light' : 'dark') : msg.theme);
    } else if (msg.type === 'setMode') {
      applyMode(msg.mode === 'toggle' ? (mode === 'slide' ? 'document' : 'slide') : msg.mode);
    }
  });

  // ---- init ----
  // KaTeX + highlight.js over the current article (Mermaid runs separately, themed).
  function renderBody() {
    ${RENDER_BODY}
  }
  // In-place update from the extension: swap the article, re-run the renderers on the new
  // nodes, refresh the map/deck/frames — the window and its scroll position stay. This is
  // what makes typing feel stable: no reload, no state restore, no flicker.
  function applyUpdate(articleHtml, newAnchor) {
    var article = document.querySelector('article');
    if (!article) return;
    settle();
    article.innerHTML = articleHtml;
    renderBody();
    mermaidStashed = false; // fresh <pre class="mermaid"> nodes carry their source as text
    if (typeof newAnchor === 'number') anchorLine = newAnchor;
    watchImages();
    runMermaid(afterRender); // -> buildMap / buildDeck / buildFrames, settle, restoreAnchor
    buildMap();
    restoreAnchor();
  }
  function init() {
    renderBody();
    root.setAttribute('data-theme', theme);
    if (PRINT_FRAMES) {
      // Video-frame print layout: no deck, no sync, no scroll chrome — just the frames.
      enterFrames();
      return;
    }
    autoHide(window);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', buildMap);
    applyMode(mode); // builds the deck when starting in slide mode
    settle();
    runMermaid(afterRender); // render diagrams in the active theme, then refresh deck/map
    buildMap();
    if (mode === 'document') {
      if (IS_PREVIEW && SCROLL_SYNC && anchorLine !== null) {
        restoreAnchor(); // by source line: survives height changes above the anchor
      } else {
        var prev = readState();
        if (prev && typeof prev.scrollY === 'number') window.scrollTo(0, prev.scrollY);
      }
    }
    watchImages();
    post({ type: 'uiState', mode: mode, theme: theme });
  }

  // ================= 16:9 video-frame print layout (export only) =================
  // Switch this page into the frames layout: from the start (printFrames export) or later,
  // from the right-click menu of any saved / printed HTML that is being viewed as slides.
  function enterFrames() {
    PRINT_FRAMES = true;
    mode = 'slide';
    root.setAttribute('data-print', 'frames');
    root.setAttribute('data-mode', 'slide');
    if (!document.getElementById('frames-style')) {
      var st = document.createElement('style');
      st.id = 'frames-style';
      st.textContent = FRAMES_CSS;
      document.head.appendChild(st);
    }
    teardownDeck();
    closeMenu();
    disablePrintRules();
    runMermaid(afterRender); // -> buildFrames() once diagrams (if any) are in
  }
  // Mirrors render_slide_pngs.js: one .slide-page per video page, the .slide inside laid
  // out exactly as the deck's slide mode (same class, same CSS, fixed to FRAME_W x FRAME_H),
  // images capped at 62% of the frame height (--fit-images 62), pages split greedily at
  // block boundaries when a block's bottom passes the frame (plus <div class="pagebreak">),
  // later blocks hidden and the page scrolled to its first block — the video frame itself.
  var framesEl = null;
  function disablePrintRules() {
    // The stylesheet's @media print / @page rules describe the A4 document printout
    // (light palette, pt sizes, 33vh figures). Frames must print as the SCREEN layout the
    // video was rendered from, so drop those rules — except our own frames <style>.
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      if (sh.ownerNode && sh.ownerNode.id === 'frames-style') continue;
      var rules;
      try { rules = sh.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (var r = rules.length - 1; r >= 0; r--) {
        var rule = rules[r];
        var isPrintMedia = rule.media && /print/.test(rule.media.mediaText);
        var isPage = (window.CSSPageRule && rule instanceof CSSPageRule);
        if (isPrintMedia || isPage) { try { sh.deleteRule(r); } catch (e) {} }
      }
    }
  }
  function slideGroups() {
    var article = document.querySelector('article');
    if (!article) return [];
    var groups = [[]];
    var kids = Array.prototype.slice.call(article.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      var isSep = node.nodeType === 1 && node.classList && node.classList.contains('slide-sep');
      if (isSep) groups.push([]); else groups[groups.length - 1].push(node);
    }
    // Same emptiness rule as buildDeck(): text, or an image / svg / table.
    return groups.filter(function (g) {
      var probe = document.createElement('section');
      for (var k = 0; k < g.length; k++) probe.appendChild(g[k].cloneNode(true));
      return probe.textContent.trim().length > 0 || probe.querySelector('img, svg, table');
    });
  }
  function loadAllImages() {
    var imgs = Array.prototype.slice.call(document.images);
    return Promise.all(imgs.map(function (im) {
      im.loading = 'eager';
      var loaded = (im.complete && im.naturalWidth > 0) ? Promise.resolve()
        : new Promise(function (res) {
            im.addEventListener('load', res, { once: true });
            im.addEventListener('error', res, { once: true });
            setTimeout(res, 15000);
          });
      return loaded.then(function () {
        var dec = im.decode ? im.decode().catch(function () {}) : Promise.resolve();
        return Promise.race([dec, new Promise(function (r) { setTimeout(r, 5000); })]);
      });
    }));
  }
  function makePage(group) {
    var pg = document.createElement('section');
    pg.className = 'slide-page';
    var sl = document.createElement('div');
    sl.className = 'slide active';
    var wrap = document.createElement('div');
    wrap.className = 'pg-scroll';
    for (var i = 0; i < group.length; i++) {
      var node = group[i];
      // The video frames carry no slide-number badge — drop it even when the page was
      // exported with badges and switched into frames afterwards.
      if (node.nodeType === 1 && node.classList && node.classList.contains('slide-no')) continue;
      wrap.appendChild(node.cloneNode(true));
    }
    sl.appendChild(wrap);
    pg.appendChild(sl);
    return pg;
  }
  function buildFrames() {
    if (framesEl && framesEl.parentNode) framesEl.parentNode.removeChild(framesEl);
    framesEl = document.createElement('div');
    framesEl.className = 'frames';
    document.body.appendChild(framesEl);
    document.body.removeAttribute('data-frames-ready');
    var groups = slideGroups();
    loadAllImages().then(function () {
      for (var n = 0; n < groups.length; n++) {
        var pg = makePage(groups[n]);
        framesEl.appendChild(pg);
        var sl = pg.firstChild, wrap = sl.firstChild;
        void sl.offsetHeight;
        var H = sl.clientHeight;
        var blocks = Array.prototype.slice.call(wrap.children);
        // offsetTop is measured from the .slide (position:absolute -> offsetParent) padding
        // edge, exactly as render_slide_pngs.js measures it against the deck's .slide.
        var tops = blocks.map(function (b) { return b.offsetTop; });
        var bots = blocks.map(function (b, i) { return tops[i] + b.offsetHeight; });
        var forced = blocks.map(function (b) { return !!(b.classList && b.classList.contains('pagebreak')); });
        var pages = [], start = 0, first = 0;
        for (var i = 0; i < blocks.length; i++) {
          if (i > first && (forced[i] || bots[i] - start > H)) {
            pages.push({ y: start, last: i - 1, first: first });
            first = i; start = tops[i];
          }
        }
        pages.push({ y: start, last: blocks.length - 1, first: first });
        // The video sets scrollTop = y on a real scroller, and a scroller clamps to
        // scrollHeight - clientHeight: a last page shorter than the frame therefore shows the
        // slide bottom-aligned, with the end of the previous page still visible at the top.
        // Reproduce that clamp — it is what the frames look like.
        var maxScroll = Math.max(0, sl.scrollHeight - sl.clientHeight);
        for (var k = 0; k < pages.length; k++) {
          var el = (k === 0) ? pg : pg.cloneNode(true);
          if (k > 0) framesEl.appendChild(el);
          el.setAttribute('data-slide', String(n + 1));
          el.setAttribute('data-page', String(k + 1));
          el.setAttribute('data-pages', String(pages.length));
          var w = el.firstChild.firstChild;
          var bl = Array.prototype.slice.call(w.children);
          for (var j = 0; j < bl.length; j++) bl[j].style.visibility = (j > pages[k].last) ? 'hidden' : '';
          // "scrollTop = y" of the video, done as a transform so the printed page keeps it.
          var yEff = Math.min(pages[k].y, maxScroll);
          // A single block taller than the frame (long code / table): the video renderer
          // has no --autofit here and cuts it. The printout instead starts the page at that
          // block (no scroll clamp) and scales it down about the top-left corner until the
          // page's blocks fit, recording the factor in data-fit.
          var pageH = bots[pages[k].last] - pages[k].y;
          var fit = 1;
          if (pageH > H) { fit = H / pageH; yEff = pages[k].y; }
          var tf = yEff ? 'translateY(' + (-yEff) + 'px)' : '';
          if (fit < 1) {
            // Scale about the frame's top-left, not the wrapper's: the wrapper sits below
            // the slide's top padding, and scaling about its own corner would leave the
            // block that much lower than the frame edge.
            w.style.transformOrigin = '0 ' + (-w.offsetTop) + 'px';
            tf = 'scale(' + fit.toFixed(4) + ') ' + tf;
            el.setAttribute('data-fit', fit.toFixed(3));
          }
          w.style.transform = tf;
        }
      }
      document.body.setAttribute('data-frames-ready', '1');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
</script>`;
}
/**
 * Styles for the 16:9 video-frame print layout. Everything the video renderer expressed in
 * viewport units (`.slide` padding 6vh/7vw/12vh, `--fit-images 62` → `max-height: 62vh`,
 * `.figure img` 86vh) is fixed here in px at the 853.33×480 frame, so the page looks the
 * same on screen (any window size) and on paper (`@page` = one frame). The client deletes
 * the stylesheet's own `@media print` / `@page` rules in this mode — see `disablePrintRules`.
 */
function framesStyleTag(nonceAttr) {
    return `<style id="frames-style"${nonceAttr}>\n${framesCss()}\n</style>`;
}
function framesCss() {
    const W = "853.333px", H = "480px";
    return `@page { size: ${W} ${H}; margin: 0; }
:root[data-print="frames"] body { overflow: auto !important; margin: 0; background: #3a3a3a; }
:root[data-print="frames"] main {
  position: absolute; left: 0; top: 0; width: ${W}; visibility: hidden; pointer-events: none;
}
:root[data-print="frames"] .deck { display: none !important; }
.frames { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 0; }
.frames .slide-page {
  position: relative; width: ${W}; height: ${H}; overflow: hidden;
  background: var(--bg); color: var(--ink); box-shadow: 0 0 0 1px #000;
}
.frames .slide-page > .slide {
  display: block; position: absolute; inset: 0;
  overflow-x: hidden; overflow-y: auto;
  padding: 28.8px 59.733px 57.6px; /* = 6vh clamp(28px, 7vw, 160px) 12vh at 853.33x480 */
}
.frames .pg-scroll > :first-child { margin-top: 0; } /* the deck's .slide > :first-child */
.frames .slide img { max-height: 297.6px; width: auto; height: auto; object-fit: contain; } /* 62vh */
@media print {
  :root[data-print="frames"] body { background: transparent; }
  .frames { display: block; padding: 0; gap: 0; }
  .frames .slide-page { box-shadow: none; break-after: page; page-break-after: always; margin: 0; }
  .frames .slide-page:last-child { break-after: auto; page-break-after: auto; }
  .frames, .frames * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .frames .slide-page > .slide { overflow: hidden; }
}`;
}
/** The CDN origin, listed only when an asset still comes from there. */
function cdn(usesCdn) {
    return usesCdn ? ` ${CDN_ORIGIN}` : "";
}
function previewCsp(cspSource, nonce, usesCdn) {
    return ("default-src 'none'; " +
        `img-src ${cspSource} https: data: blob:; ` +
        `style-src ${cspSource}${cdn(usesCdn)} 'unsafe-inline'; ` +
        `font-src ${cspSource}${cdn(usesCdn)} data:; ` +
        `script-src 'nonce-${nonce}'${cdn(usesCdn)};`);
}
/**
 * Standalone files carry everything they need inline, so the offline policy grants no
 * network origin at all beyond images (a document may legitimately reference remote ones).
 */
function exportCsp(nonce, usesCdn) {
    return ("default-src 'none'; " +
        "img-src https: data:; " +
        `style-src 'unsafe-inline'${cdn(usesCdn)}; ` +
        `font-src data:${cdn(usesCdn)}; ` +
        `script-src 'nonce-${nonce}'${cdn(usesCdn)};`);
}
/** jsDelivr URLs, used when `media/vendor/` was never populated (see src/assets.ts). */
exports.CDN_ASSETS = {
    fontCss: [
        ["Freesentation-4Regular.woff2", 400],
        ["Freesentation-7Bold.woff2", 700],
    ]
        .map(([file, weight]) => `@font-face{font-family:'Presentation';src:url("${CDN_ORIGIN}/gh/projectnoonnu/2404@1.0/${file}") ` +
        `format('woff2');font-weight:${weight};font-style:normal;font-display:swap}`)
        .join("\n"),
    katexCss: { href: exports.KATEX_CSS_HREF },
    katexJs: { href: exports.KATEX_JS_SRC },
    hljsJs: { href: exports.HLJS_JS_SRC },
    mermaidJs: { href: exports.MERMAID_JS_SRC },
    usesCdn: true,
};
/**
 * `</script` / `</style` inside a bundle's own string literals would end the tag early.
 * Neither current bundle contains one, but a future version might, and the escape is inert
 * everywhere else.
 */
function escapeForTag(body, tag) {
    return body.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}
function styleTag(ref, nonceAttr) {
    return ref.text !== undefined
        ? `<style${nonceAttr}>\n${escapeForTag(ref.text, "style")}\n</style>`
        : `<link rel="stylesheet"${nonceAttr} href="${ref.href}">`;
}
/**
 * Inlined bundles are emitted WITHOUT `defer` — a classic inline script runs the moment it
 * is parsed, which is still before the client script's DOMContentLoaded init, so
 * window.katex / hljs / mermaid are ready either way.
 */
function scriptTag(ref, nonceAttr) {
    return ref.text !== undefined
        ? `<script${nonceAttr}>\n${escapeForTag(ref.text, "script")}\n</script>`
        : `<script defer${nonceAttr} src="${ref.href}"></script>`;
}
function buildHtmlDocument(options) {
    const { title, articleHtml, css, cspSource, nonce, scrollSync = true, theme = "dark", mode = "document", assets = exports.CDN_ASSETS, printFrames = false, anchorLine, } = options;
    const isPreview = Boolean(cspSource);
    let csp = "";
    if (isPreview && nonce) {
        csp = previewCsp(cspSource, nonce, assets.usesCdn);
    }
    else if (nonce) {
        csp = exportCsp(nonce, assets.usesCdn);
    }
    const cspMeta = csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` : "";
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    const katexScript = scriptTag(assets.katexJs, nonceAttr);
    const renderScript = clientScript(isPreview, nonce ?? "", scrollSync, printFrames);
    const framesStyle = printFrames ? `
${framesStyleTag(nonceAttr)}` : "";
    const rootAttrs = (printFrames ? ' data-print="frames"' : "") +
        (typeof anchorLine === "number" && Number.isFinite(anchorLine)
            ? ` data-anchor-line="${Math.max(0, Math.round(anchorLine))}"`
            : "");
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
<html lang="ko" data-theme="${theme}" data-mode="${printFrames ? "slide" : mode}"${rootAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta}<title>${(0, htmlEscape_1.escapeHtml)(title)}</title>
${styleTag(assets.katexCss, nonceAttr)}
<style${nonceAttr}>
${assets.fontCss}
${css}
</style>${framesStyle}
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
//# sourceMappingURL=htmlTemplate.js.map