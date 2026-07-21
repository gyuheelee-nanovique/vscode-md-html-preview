"use strict";
/**
 * Full HTML document shell.
 *
 * Builds the `<head>`/`<body>` wrapper around the rendered article: inlined CSS,
 * KaTeX from CDN, the Freesentation font, A4 print CSS, and one unified client script.
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
 * origin; **export** (no `cspSource`) is a portable standalone file with a CDN-only CSP.
 * Both nonce every script and never enable `script-src 'unsafe-inline'`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERMAID_JS_SRC = exports.HLJS_CSS_HREF = exports.HLJS_JS_SRC = exports.KATEX_JS_SRC = exports.KATEX_CSS_HREF = void 0;
exports.buildHtmlDocument = buildHtmlDocument;
const htmlEscape_1 = require("./htmlEscape");
exports.KATEX_CSS_HREF = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
exports.KATEX_JS_SRC = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
// highlight.js (browser bundle, ~common languages) for fenced code blocks. Loaded only
// when the article actually contains a `language-…` code block.
const HLJS_VERSION = "11.11.1";
exports.HLJS_JS_SRC = `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/highlight.min.js`;
exports.HLJS_CSS_HREF = `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/styles/github.min.css`;
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
if (window.mermaid && document.querySelector('pre.mermaid')) {
  try {
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    // mermaid.run() reads each pre.mermaid's textContent and replaces it with an <svg>.
    // It is async; swallow rejection so one bad diagram leaves its raw source in place
    // without breaking KaTeX/scroll-sync that ran synchronously above.
    var remap = function () {
      try {
        if (window.acquireVsCodeApi || window.parent !== window) {
          window.postMessage({ type: 'remap' }, '*');
        } else if (typeof window.__deckRefresh === 'function') {
          window.__deckRefresh();
        }
      } catch (e) { /* export mode: no message channel, nothing to remap */ }
    };
    Promise.resolve(window.mermaid.run()).then(remap, remap);
  } catch (err) { /* mermaid init failed: leave raw source */ }
}`.trim();
/**
 * The unified client bootstrap. `IS_PREVIEW` selects the state backend (VS Code webview
 * state vs. localStorage) and whether scroll-sync runs. Written with string concatenation
 * (no template literals / backticks) so it can be embedded in this module's own template
 * string without `${…}` collisions.
 */
function clientScript(isPreview, nonce, scrollSync) {
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
  }
  function toggleTheme() { applyTheme(theme === 'dark' ? 'light' : 'dark'); }

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
  var deck = null, slides = [];
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
  function nextSlide() { showSlide(slideIndex + 1); }
  function prevSlide() { showSlide(slideIndex - 1); }
  // Let RENDER_BODY's mermaid remap rebuild the deck in export mode once diagrams resolve.
  window.__deckRefresh = function () { if (mode === 'slide') buildDeck(); };

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
    else if (e.key === 'Home') { showSlide(0); e.preventDefault(); }
    else if (e.key === 'End') { showSlide(slides.length - 1); e.preventDefault(); }
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
      menuItem('mode', 'slide', '슬라이드');
    document.body.appendChild(menuEl);
    var w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    menuEl.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menuEl.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 8)) + 'px';
    menuEl.addEventListener('click', function (ev) {
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
      if (!IS_PREVIEW || !SCROLL_SYNC || mode === 'slide') return;
      if (!lineMap.length) buildMap();
      scrollToLine(msg.line);
    } else if (msg.type === 'remap') {
      buildMap();
      if (mode === 'slide') buildDeck();
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
    buildMap();
    applyMode(mode); // builds the deck when starting in slide mode
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
function previewCsp(cspSource, nonce) {
    return ("default-src 'none'; " +
        `img-src ${cspSource} https: data: blob:; ` +
        `style-src ${cspSource} ${CDN_ORIGIN} 'unsafe-inline'; ` +
        `font-src ${cspSource} ${CDN_ORIGIN} data:; ` +
        `script-src 'nonce-${nonce}' ${CDN_ORIGIN};`);
}
function exportCsp(nonce) {
    return ("default-src 'none'; " +
        "img-src https: data:; " +
        `style-src 'unsafe-inline' ${CDN_ORIGIN}; ` +
        `font-src ${CDN_ORIGIN} data:; ` +
        `script-src 'nonce-${nonce}' ${CDN_ORIGIN};`);
}
function buildHtmlDocument(options) {
    const { title, articleHtml, css, cspSource, nonce, scrollSync = true, theme = "dark", mode = "document", } = options;
    const isPreview = Boolean(cspSource);
    let csp = "";
    if (isPreview && nonce) {
        csp = previewCsp(cspSource, nonce);
    }
    else if (nonce) {
        csp = exportCsp(nonce);
    }
    const cspMeta = csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` : "";
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
    const katexScript = `<script defer${nonceAttr} src="${exports.KATEX_JS_SRC}"></script>`;
    const renderScript = clientScript(isPreview, nonce ?? "", scrollSync);
    // Load highlight.js only when a fenced code block with a language is present. The
    // theme link precedes the inlined <style> so preview.css can override its background.
    const hasCode = articleHtml.includes('class="language-');
    const hljsCss = hasCode ? `<link rel="stylesheet" href="${exports.HLJS_CSS_HREF}">\n` : "";
    const hljsScript = hasCode ? `\n<script defer${nonceAttr} src="${exports.HLJS_JS_SRC}"></script>` : "";
    // Load Mermaid only when a `<pre class="mermaid">` diagram is present. `defer` makes it
    // execute before DOMContentLoaded, so window.mermaid is ready when RENDER_BODY runs in
    // both the preview and export render scripts. No CSP change is required (see CDN_ORIGIN).
    const hasMermaid = articleHtml.includes('class="mermaid"');
    const mermaidScript = hasMermaid ? `\n<script defer${nonceAttr} src="${exports.MERMAID_JS_SRC}"></script>` : "";
    return `<!doctype html>
<html lang="ko" data-theme="${theme}" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta}<title>${(0, htmlEscape_1.escapeHtml)(title)}</title>
<link rel="stylesheet" href="${exports.KATEX_CSS_HREF}">
${hljsCss}<style>
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
//# sourceMappingURL=htmlTemplate.js.map