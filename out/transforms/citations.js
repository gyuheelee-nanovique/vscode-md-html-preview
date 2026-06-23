"use strict";
/**
 * Citation / link handling.
 *
 * The paper pipeline preserves citation markers like `[13]`, `[81, 82]`, `[71-73]`
 * as plain text and strips Markdown links so no `<a>` tags survive (matching
 * `strip_markdown_links` in `tools/pdf_to_html.py`). When `keepLinks` is true the
 * text is returned untouched and the inline renderer turns `[text](url)` into anchors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripMarkdownLinks = stripMarkdownLinks;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
/** Repeatedly collapse `[text](url)` → `text` until stable (handles nested forms). */
function stripMarkdownLinks(text, keepLinks) {
    if (keepLinks) {
        return text;
    }
    let current = text;
    // Loop because a single pass cannot collapse links nested inside link text.
    for (;;) {
        const updated = current.replace(LINK_RE, (_m, label) => label);
        if (updated === current) {
            return updated;
        }
        current = updated;
    }
}
//# sourceMappingURL=citations.js.map