"use strict";
/**
 * Markdown → article HTML.
 *
 * The block parser is a faithful TypeScript port of `markdown_to_article_html` in
 * `tools/pdf_to_html.py` (headings, full-line images, pipe tables incl. the docling
 * simulation table, `` ```math `` blocks, table captions, references folding) so the
 * live preview matches the standalone export.
 *
 * Fidelity notes (the reference pipeline is the source of truth):
 *  - `**bold**` IS rendered (`<strong>`), but single-asterisk `*italic*` is NOT: bare
 *    single asterisks are common in papers as math superscripts (`\(v_t^*(x)\)`) and
 *    author markers (`Liu * Univ.`); double `**` pairs do not occur there, so bold is
 *    safe while italic conversion would corrupt real documents.
 *  - The inline path otherwise mirrors `inline()` exactly (link stripping, `$…$` math
 *    spans, `$`…`$` normalization). Markdown links become `<a>` only when `keepLinks`
 *    is enabled (the non-default opt-out of plain citations), with the href escaped.
 *  - Beyond the pipeline, block-level constructs a general preview needs — fenced code,
 *    block-quotes, lists, horizontal rules — are recognized, but only when they begin a
 *    block after a blank line; a wrapped paragraph line that happens to start with one
 *    of those markers stays folded into the paragraph, exactly as the pipeline does.
 *
 * Image `src` resolution is delegated to the caller via `resolveImage`, which returns
 * a Webview resource URI for the live preview or a base64 data URI for export.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inline = inline;
exports.prepareMermaidMath = prepareMermaidMath;
exports.addSourceLine = addSourceLine;
exports.stripHtmlComments = stripHtmlComments;
exports.commentLineMask = commentLineMask;
exports.markdownToArticleHtml = markdownToArticleHtml;
const htmlEscape_1 = require("./htmlEscape");
const citations_1 = require("./transforms/citations");
const math_1 = require("./transforms/math");
const tables_1 = require("./transforms/tables");
const references_1 = require("./transforms/references");
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;
const DISPLAY_MATH_RE = /^\$\$([\s\S]*?)\$\$$/;
const BULLET_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^\d+[.)]\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const TABLE_CAPTION_RE = /^표\s+\d+[.\s]/;
// A transcript "speaker turn": a bold label followed by a colon at line start, e.g.
// `**A**: …` or `**김 부장**：…`. A run of 2+ such lines is kept line-broken (below) so
// speaker-separated transcripts don't collapse into one space-joined paragraph.
const SPEAKER_RE = /^\*\*[^*\n]{1,40}\*\*\s*[:：]/;
const SAFE_HREF_RE = /^(https?:|mailto:|#|\/|\.)/i;
// A block that begins with an HTML tag (`<div …>`, `<table>`, page-break divs, …) is
// passed through verbatim as a raw HTML block, matching CommonMark HTML blocks.
const HTML_BLOCK_RE = /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/?>/;
// Inline HTML tags allowed to pass through un-escaped (no-attribute, safe subset).
const INLINE_HTML_RE = /&lt;(\/?(?:br|sub|sup|u|s|mark|small|kbd|del|ins|wbr|abbr|cite|q)\s*\/?)&gt;/gi;
// A source line forcing a hard line break (`<br>`): trailing 2+ spaces or a backslash.
const HARD_BREAK_RE = /(?: {2,}|\\)\s*$/;
/**
 * Inline-format an already-HTML-escaped segment.
 *  - `**bold**` → `<strong>` (rendered with the Freesentation bold weight). Safe because
 *    double `**` pairs do not occur in the docling/arXiv outputs, unlike single `*`.
 *  - Single-asterisk `*italic*` is intentionally NOT converted: bare single asterisks
 *    appear in papers as math superscripts (`\(v_t^*\)`) and author markers (`Liu *`),
 *    so converting them corrupts real documents.
 *  - Markdown links become `<a>` only when `keepLinks` is enabled; the href is
 *    attribute-escaped and scheme-validated so a crafted link cannot inject attributes.
 */
function applyInlineFormatting(escaped, keepLinks) {
    let out = escaped;
    if (keepLinks) {
        out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
            if (!SAFE_HREF_RE.test(href)) {
                return label;
            }
            return `<a href="${(0, htmlEscape_1.escapeAttr)(href)}" rel="noreferrer">${label}</a>`;
        });
    }
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return out;
}
/**
 * Inline renderer ported from `inline()` in `tools/pdf_to_html.py`: protects inline
 * code, normalizes `$`...`$`, applies textual math fixes, then walks `$...$` spans
 * emitting `<span class="math-tex">` for KaTeX while escaping the text in between.
 */
function inline(rawText, keepLinks) {
    let text = (0, htmlEscape_1.unescapeHtml)(rawText);
    text = (0, citations_1.stripMarkdownLinks)(text, keepLinks);
    // $`expr`$  ->  $expr$
    text = text.replace(/\$`([^`]+)`\$/g, "$$$1$$");
    text = text.replace(/\\_/g, "_");
    text = (0, math_1.textualMathFixes)(text);
    // Protect inline code spans before math/emphasis scanning so `$` and `*` inside
    // backticks are treated literally. The NUL sentinel cannot occur in Markdown source,
    // so a placeholder never collides with real text.
    const codeSpans = [];
    text = text.replace(/`([^`]+)`/g, (_m, code) => {
        const idx = codeSpans.push(code) - 1;
        return `\x00c${idx}\x00`;
    });
    // Park math in placeholders too, instead of splitting the string around it. Splitting
    // cut `**bold with $x$ inside**` into separate segments, so the `**` pair never matched
    // — the emphasis was dropped and the literal asterisks showed through. With math parked,
    // emphasis is applied to the whole string and can span across math. `$$…$$` is matched
    // before single `$…$` (listed first in the alternation) so a display pair is never
    // mis-read as two adjacent inline spans.
    const mathSpans = [];
    const mathRe = /\$\$([\s\S]+?)\$\$|\$(.+?)\$/g;
    text = text.replace(mathRe, (_m, display, inlineExpr) => {
        const html = display !== undefined
            ? `<span class="math-tex" data-display="true">${(0, htmlEscape_1.escapeHtml)((0, math_1.normalizeDisplayMath)(display))}</span>`
            : `<span class="math-tex">${(0, htmlEscape_1.escapeHtml)((0, math_1.normalizeMath)(inlineExpr))}</span>`;
        const idx = mathSpans.push(html) - 1;
        return `\x00m${idx}\x00`;
    });
    let out = applyInlineFormatting((0, htmlEscape_1.escapeHtml)(text), keepLinks);
    // Restore placeholders. Math HTML is already built and escaped; code is escaped here.
    out = out.replace(/\x00m(\d+)\x00/g, (_m, idx) => mathSpans[Number(idx)] ?? "");
    out = out.replace(/\x00c(\d+)\x00/g, (_m, idx) => {
        const code = codeSpans[Number(idx)];
        return code === undefined ? "" : `<code>${(0, htmlEscape_1.escapeHtml)(code)}</code>`;
    });
    // Allow a safe subset of inline HTML tags (e.g. <br>) to pass through un-escaped.
    return out.replace(INLINE_HTML_RE, "<$1>");
}
/**
 * Whether `line` ends the current paragraph. Mirrors the pipeline's continuation breaks
 * exactly — blank line, heading, full-line image, pipe table, and (inside references) a
 * reference line. Block constructs the preview adds (fences, rules, quotes, lists) are
 * deliberately NOT break conditions here: they only start a block at the top of the
 * parse loop after a blank line, so a wrapped paragraph line beginning with `-`, `>`,
 * ```` ``` ````, etc. stays folded into the paragraph just as the pipeline keeps it.
 */
function startsNewBlock(line, inReferences) {
    const s = line.trim();
    if (!s) {
        return true;
    }
    return (HEADING_RE.test(line) ||
        IMAGE_LINE_RE.test(s) ||
        line.replace(/^\s+/, "").startsWith("|") ||
        (inReferences && references_1.REFERENCE_LINE_RE.test(s)));
}
/** One `<br/>`-separated label line → a KaTeX fragment (text runs in `\text{}`, math kept). */
function mermaidLineToKatex(line) {
    const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
        out += (0, math_1.sanitizeTextRun)(line.slice(last, m.index));
        out += (0, math_1.normalizeMath)(m[1] !== undefined ? m[1] : m[2]);
        last = re.lastIndex;
    }
    out += (0, math_1.sanitizeTextRun)(line.slice(last));
    return out || "\\text{}";
}
/**
 * Prepare LaTeX inside Mermaid labels. Mermaid only renders math wrapped in double dollars
 * (`$$…$$`); a single `$…$` leaks as raw text — and these documents write inline math with a
 * single `$` — so single-`$` spans are upgraded to `$$`.
 *
 * A label that mixes `<br/>` with math is special: Mermaid's math renderer flattens `<br/>`
 * to a space (the line break is lost). Mermaid also unescapes `\\`→`\`, so a KaTeX row break
 * needs `\\\\` in the source. Such labels are rebuilt as one `\begin{gathered}` block whose
 * lines are joined with `\\\\`, keeping the breaks while rendering the math. Labels with no
 * `$` (plain text, where Mermaid's own `<br/>` handling already works) are left untouched.
 */
function prepareMermaidMath(source) {
    return source.replace(/"([^"\n]*)"/g, (whole, label) => {
        if (!label.includes("$")) {
            return whole;
        }
        if (/<br\s*\/?>/i.test(label)) {
            const lines = label
                .split(/<br\s*\/?>/i)
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
                .map(mermaidLineToKatex);
            return `"$$\\begin{gathered}${lines.join("\\\\\\\\")}\\end{gathered}$$"`;
        }
        const upgraded = label.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_m, display, inlineExpr) => `$$${(0, math_1.normalizeMath)(display !== undefined ? display : inlineExpr)}$$`);
        return `"${upgraded}"`;
    });
}
/**
 * Stamp the block's source-line SPAN onto its first opening tag. Scroll-sync interpolates
 * within `[data-source-line, data-source-line-end]` using the block's real pixel bounds, so
 * a block that is tall in the preview but short in source (image, Mermaid) — or the reverse
 * — maps accurately, and comment/blank gaps between blocks act as dead zones. Start-only
 * anchors made the mapping drift across such gaps.
 */
function addSourceLine(html, line, endLine = line) {
    return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, (_m, head) => `${head} data-source-line="${line}" data-source-line-end="${endLine}"`);
}
/**
 * Blank out HTML comments (`<!-- … -->`, single- or multi-line) so they don't render as
 * literal text — but preserve anything inside fenced code/math blocks. Line COUNT is
 * preserved (commented lines become empty) so `data-source-line` scroll-sync stays aligned.
 * Markers like `<!-- page 12 -->` / `<!-- image -->` thus stay invisible.
 */
function stripHtmlComments(md) {
    const out = [];
    let inFence = false;
    let fenceChar = "";
    let inComment = false;
    for (const raw of md.split(/\r\n|\r|\n/)) {
        const t = raw.trim();
        const fence = t.match(/^(`{3,}|~{3,})/);
        if (!inComment && fence) {
            if (!inFence) {
                inFence = true;
                fenceChar = fence[1][0];
            }
            else if (t[0] === fenceChar) {
                inFence = false;
            }
            out.push(raw);
            continue;
        }
        if (inFence) {
            out.push(raw);
            continue;
        }
        let line = raw;
        if (inComment) {
            const end = line.indexOf("-->");
            if (end < 0) {
                out.push(""); // whole line still inside a comment — blank it, keep the line
                continue;
            }
            line = line.slice(end + 3);
            inComment = false;
        }
        line = line.replace(/<!--[\s\S]*?-->/g, "");
        const open = line.lastIndexOf("<!--");
        if (open >= 0 && line.indexOf("-->", open) < 0) {
            line = line.slice(0, open);
            inComment = true;
        }
        out.push(line);
    }
    return out.join("\n");
}
/**
 * Per-line mask of source lines that render to nothing because an HTML comment consumed
 * them (the line had content, but after comment-stripping it is blank). Scroll-sync uses
 * it to freeze the preview while the editor's centre line sits inside a comment — those
 * lines have no visible counterpart to sync to. Mirrors `stripHtmlComments` exactly.
 */
function commentLineMask(md) {
    const lines = md.split(/\r\n|\r|\n/);
    const mask = new Array(lines.length).fill(false);
    let inFence = false;
    let fenceChar = "";
    let inComment = false;
    for (let idx = 0; idx < lines.length; idx += 1) {
        const raw = lines[idx];
        const t = raw.trim();
        const fence = t.match(/^(`{3,}|~{3,})/);
        if (!inComment && fence) {
            if (!inFence) {
                inFence = true;
                fenceChar = fence[1][0];
            }
            else if (t[0] === fenceChar) {
                inFence = false;
            }
            continue;
        }
        if (inFence) {
            continue;
        }
        let line = raw;
        let touched = false;
        if (inComment) {
            const end = line.indexOf("-->");
            if (end < 0) {
                mask[idx] = t.length > 0; // whole line still inside the comment
                continue;
            }
            line = line.slice(end + 3);
            inComment = false;
            touched = true;
        }
        const before = line;
        line = line.replace(/<!--[\s\S]*?-->/g, "");
        if (line !== before) {
            touched = true;
        }
        const open = line.lastIndexOf("<!--");
        if (open >= 0 && line.indexOf("-->", open) < 0) {
            line = line.slice(0, open);
            inComment = true;
            touched = true;
        }
        // Invisible only if a comment was involved AND nothing visible remains on the line.
        mask[idx] = touched && line.trim().length === 0 && t.length > 0;
    }
    return mask;
}
function markdownToArticleHtml(md, options) {
    const { keepLinks, removeTopImages, openReferences, resolveImage } = options;
    const withLines = options.sourceLines !== false;
    const renderInline = (text) => inline(text, keepLinks);
    const lines = stripHtmlComments(md).split(/\r\n|\r|\n/);
    const blocks = [];
    let i = 0;
    let inReferences = false;
    let referencesIndex = null;
    let referencesLine = 0;
    let imageCount = 0;
    let renderedImages = 0;
    const missingImages = [];
    let pendingTableCaption = null;
    // Each top-level block is tagged with the 0-based source line it starts on
    // (`data-source-line`) so the Webview can map editor scroll position to the preview
    // and back. `currentStartLine` is the line at the top of the iteration that builds
    // the block; `pushBlock` stamps it onto the block's outer element.
    let currentStartLine = 0;
    const pushBlock = (html) => {
        // `i` has advanced to the line after this block for multi-line handlers; for single-line
        // handlers it is still the start line — max() gives the correct last source line either way.
        const endLine = Math.max(currentStartLine, i - 1);
        blocks[blocks.length] = withLines ? addSourceLine(html, currentStartLine, endLine) : html;
    };
    while (i < lines.length) {
        const line = lines[i];
        const stripped = line.trim();
        if (!stripped) {
            i += 1;
            continue;
        }
        currentStartLine = i;
        // Math fence: ``` math / ```math
        if (stripped === "``` math" || stripped === "```math") {
            i += 1;
            const mathLines = [];
            while (i < lines.length && lines[i].trim() !== "```") {
                mathLines.push(lines[i]);
                i += 1;
            }
            if (i < lines.length && lines[i].trim() === "```") {
                i += 1;
            }
            pushBlock((0, math_1.renderMathBlock)(mathLines.join("\n")));
            continue;
        }
        // Display math block: `$$…$$` (single- or multi-line). A block that opens with
        // `$$` is consumed up to the line that closes it with `$$`, and the inner LaTeX
        // (delimiters stripped) is emitted as a display-math span. Handled before the
        // paragraph path so `$$` never reaches the inline scanner, where the single-`$`
        // regex would capture a stray leading `$` and leak the trailing `$`.
        if (stripped.startsWith("$$")) {
            const single = DISPLAY_MATH_RE.exec(stripped);
            if (single) {
                // Whole equation on one line: `$$ … $$`.
                pushBlock((0, math_1.renderDisplayMath)(single[1]));
                i += 1;
                continue;
            }
            // Multi-line: collect from the opening `$$` until a line ending with `$$`.
            const mathLines = [stripped.slice(2)];
            i += 1;
            let closed = false;
            while (i < lines.length) {
                const cur = lines[i].trim();
                if (cur.endsWith("$$")) {
                    mathLines.push(cur.slice(0, -2));
                    i += 1;
                    closed = true;
                    break;
                }
                mathLines.push(lines[i]);
                i += 1;
            }
            if (closed) {
                pushBlock((0, math_1.renderDisplayMath)(mathLines.join("\n")));
                continue;
            }
            // No closing `$$` found: fall through and render the collected text as a
            // paragraph so nothing is silently dropped.
            pushBlock(`<p>${renderInline(mathLines.join(" "))}</p>`);
            continue;
        }
        // Generic fenced code block
        const fence = FENCE_RE.exec(stripped);
        if (fence) {
            const marker = fence[1][0]; // ` or ~
            const info = fence[2].trim();
            const lang = info.split(/\s+/)[0].toLowerCase();
            const closeRe = marker === "`" ? /^`{3,}\s*$/ : /^~{3,}\s*$/;
            i += 1;
            const codeLines = [];
            while (i < lines.length && !closeRe.test(lines[i].trim())) {
                codeLines.push(lines[i]);
                i += 1;
            }
            if (i < lines.length) {
                i += 1; // consume closing fence
            }
            // Mermaid diagram: emit `<pre class="mermaid">` carrying the *raw* (escaped) diagram
            // source as text. mermaid.run() (loaded by the template) reads textContent and
            // replaces it with an <svg>. We deliberately do NOT use `language-mermaid` so
            // highlight.js's `pre code[class*="language-"]` selector skips it. The source is
            // HTML-escaped (it can contain `<br/>`, `&`, quotes) so it survives as plain text
            // until mermaid decodes it back via textContent.
            if (lang === "mermaid") {
                pushBlock(`<pre class="mermaid">${(0, htmlEscape_1.escapeHtml)(prepareMermaidMath(codeLines.join("\n")))}</pre>`);
                continue;
            }
            const langClass = info ? ` class="language-${(0, htmlEscape_1.escapeAttr)(lang)}"` : "";
            pushBlock(`<pre><code${langClass}>${(0, htmlEscape_1.escapeHtml)(codeLines.join("\n"))}</code></pre>`);
            continue;
        }
        // Heading
        const heading = HEADING_RE.exec(line);
        if (heading) {
            const text = heading[2].trim();
            const level = Math.min(heading[1].length, 6);
            // Headings render at their literal Markdown level (`#`=h1 … `######`=h6). We used to
            // force the first heading to <h1> (a docling-paper title convention), but that made
            // same-level headings inconsistent — e.g. slide 1's `##` title became h1 (bigger)
            // while every other slide's `##` stayed h2. Literal levels keep sizes uniform.
            const tag = `h${level}`;
            if (text === references_1.REFERENCE_HEADING) {
                // The pipeline marks the references section (for reference-line styling) at any
                // heading level, but only FOLDS it when it renders as exactly <h2>.
                inReferences = true;
                if (tag === "h2" && referencesIndex === null) {
                    referencesIndex = blocks.length;
                    referencesLine = currentStartLine;
                }
            }
            pushBlock(`<${tag}>${renderInline(text)}</${tag}>`);
            i += 1;
            continue;
        }
        // Horizontal rule / slide separator. `---` (and `***`/`___`) is a thin rule in the
        // continuous document + print view, and doubles as the slide boundary that slide mode
        // paginates on (the client groups the blocks between successive `.slide-sep` markers
        // into individual slides).
        if (HR_RE.test(stripped)) {
            pushBlock('<hr class="slide-sep">');
            i += 1;
            continue;
        }
        // Full-line image
        const imageMatch = IMAGE_LINE_RE.exec(stripped);
        if (imageMatch) {
            imageCount += 1;
            const alt = imageMatch[1];
            const rel = imageMatch[2];
            if (imageCount <= removeTopImages) {
                i += 1;
                continue;
            }
            const src = resolveImage(rel);
            if (src) {
                renderedImages += 1;
                pushBlock('<figure class="figure">' +
                    `<img src="${(0, htmlEscape_1.escapeAttr)(src)}" alt="${(0, htmlEscape_1.escapeAttr)(alt)}" loading="lazy" decoding="async">` +
                    "</figure>");
            }
            else {
                missingImages.push(rel);
                pushBlock('<figure class="figure">' +
                    `<div class="image-missing">이미지를 찾을 수 없습니다: ${(0, htmlEscape_1.escapeHtml)(rel)}</div>` +
                    "</figure>");
            }
            i += 1;
            continue;
        }
        // Pipe table
        if (line.replace(/^\s+/, "").startsWith("|")) {
            const tableLines = [];
            while (i < lines.length && lines[i].replace(/^\s+/, "").startsWith("|")) {
                tableLines.push(lines[i]);
                i += 1;
            }
            pushBlock((0, tables_1.renderTable)(tableLines, pendingTableCaption, renderInline));
            pendingTableCaption = null;
            continue;
        }
        // Blockquote
        if (BLOCKQUOTE_RE.test(stripped)) {
            const inner = [];
            while (i < lines.length && BLOCKQUOTE_RE.test(lines[i].trim())) {
                inner.push(lines[i].trim().replace(/^>\s?/, ""));
                i += 1;
            }
            const parts = [];
            let j = 0;
            while (j < inner.length) {
                const t = inner[j].trim();
                if (!t) {
                    j += 1;
                    continue;
                }
                // Pipe table inside the quote: collect the contiguous run and reuse renderTable.
                if (t.startsWith("|")) {
                    const tableLines = [];
                    while (j < inner.length && inner[j].trim().startsWith("|")) {
                        tableLines.push(inner[j]);
                        j += 1;
                    }
                    parts.push((0, tables_1.renderTable)(tableLines, null, renderInline));
                    continue;
                }
                // Otherwise gather a paragraph run up to the next blank / table line.
                const para = [t];
                j += 1;
                while (j < inner.length && inner[j].trim() && !inner[j].trim().startsWith("|")) {
                    para.push(inner[j].trim());
                    j += 1;
                }
                parts.push(`<p>${renderInline(para.join(" "))}</p>`);
            }
            pushBlock(`<blockquote>${parts.join("\n")}</blockquote>`);
            continue;
        }
        // Bullet list
        if (BULLET_RE.test(stripped)) {
            const items = [];
            let m;
            while (i < lines.length && (m = BULLET_RE.exec(lines[i].trim())) !== null) {
                items.push(`<li>${renderInline(m[1].trim())}</li>`);
                i += 1;
            }
            pushBlock(`<ul>${items.join("")}</ul>`);
            continue;
        }
        // Ordered list (outside references; reference numbering is handled separately)
        if (!inReferences && ORDERED_RE.test(stripped)) {
            const items = [];
            let m;
            while (i < lines.length && (m = ORDERED_RE.exec(lines[i].trim())) !== null) {
                items.push(`<li>${renderInline(m[1].trim())}</li>`);
                i += 1;
            }
            pushBlock(`<ol>${items.join("")}</ol>`);
            continue;
        }
        // Reference list line
        if (inReferences && references_1.REFERENCE_LINE_RE.test(stripped)) {
            pushBlock(`<p class="reference">${renderInline(stripped)}</p>`);
            i += 1;
            continue;
        }
        // Block-level raw HTML passthrough (e.g. <div …>, <table>, page-break divs).
        if (HTML_BLOCK_RE.test(stripped)) {
            const htmlLines = [];
            while (i < lines.length && lines[i].trim()) {
                htmlLines.push(lines[i]);
                i += 1;
            }
            pushBlock(htmlLines.join("\n"));
            continue;
        }
        // Paragraph (with docling table-caption lookahead)
        const paraRaw = [line];
        i += 1;
        while (i < lines.length && !startsNewBlock(lines[i], inReferences)) {
            paraRaw.push(lines[i]);
            i += 1;
        }
        const para = paraRaw.map((l) => l.trim());
        // Transcript run: 2+ speaker turns ("**Name**: …") with no blank lines between them
        // would otherwise fold into one space-joined paragraph with no visible breaks. Keep
        // each turn on its own line; a continuation line (no speaker prefix) sticks to its turn.
        if (para.filter((l) => SPEAKER_RE.test(l)).length >= 2) {
            const turns = [];
            for (const ln of para) {
                if (SPEAKER_RE.test(ln) || turns.length === 0) {
                    turns.push(renderInline(ln));
                }
                else {
                    turns[turns.length - 1] += " " + renderInline(ln);
                }
            }
            pushBlock(`<p class="transcript">${turns.join("<br>\n")}</p>`);
            continue;
        }
        const text = para.join(" ");
        if (TABLE_CAPTION_RE.test(text) && i < lines.length) {
            let lookahead = i;
            while (lookahead < lines.length && !lines[lookahead].trim()) {
                lookahead += 1;
            }
            if (lookahead < lines.length && lines[lookahead].replace(/^\s+/, "").startsWith("|")) {
                pendingTableCaption = text;
                continue;
            }
        }
        // Hard line breaks: a source line ending with 2+ spaces or a backslash forces <br>.
        const lineParts = [];
        for (let k = 0; k < para.length; k += 1) {
            const hard = k < para.length - 1 && HARD_BREAK_RE.test(paraRaw[k]);
            // A trailing backslash hard-break marker is dropped from the text (CommonMark).
            const seg = hard && para[k].endsWith("\\") ? para[k].slice(0, -1).trimEnd() : para[k];
            lineParts.push(renderInline(seg));
            if (k < para.length - 1) {
                lineParts.push(hard ? "<br>\n" : " ");
            }
        }
        pushBlock(`<p>${lineParts.join("")}</p>`);
    }
    const finalBlocks = referencesIndex !== null
        ? (0, references_1.wrapReferences)(blocks, referencesIndex, openReferences, withLines ? referencesLine : undefined)
        : blocks;
    return {
        articleHtml: finalBlocks.join("\n\n"),
        imageCount,
        renderedImages,
        missingImages,
    };
}
//# sourceMappingURL=markdownRenderer.js.map