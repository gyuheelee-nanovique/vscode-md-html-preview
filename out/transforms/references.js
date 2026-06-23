"use strict";
/**
 * References folding.
 *
 * The `참고문헌` (References) heading and everything after it is wrapped in a
 * `<details class="references">` element so it can be collapsed on screen and kept
 * open for print, matching the paper HTML pipeline in `tools/pdf_to_html.py`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENCE_LINE_RE = exports.REFERENCE_HEADING = void 0;
exports.wrapReferences = wrapReferences;
exports.REFERENCE_HEADING = "참고문헌";
/** A reference list line: `[12] ...` or `12. ...`. */
exports.REFERENCE_LINE_RE = /^(?:\[)?\d+\.\s+/;
/**
 * Replace the references heading block (and the blocks after it) with a single
 * `<details>` block. `blocks` are the already-rendered top-level HTML blocks;
 * `headingIndex` is the index of the `참고문헌` heading block.
 */
function wrapReferences(blocks, headingIndex, open, headingLine) {
    if (headingIndex < 0 || headingIndex >= blocks.length) {
        return blocks;
    }
    const refsHtml = blocks.slice(headingIndex + 1).join("\n\n").trim();
    const openAttr = open ? " open" : "";
    const lineAttr = headingLine !== undefined ? ` data-source-line="${headingLine}"` : "";
    const details = `<details class="references" id="references"${openAttr}${lineAttr}>\n` +
        `<summary>${exports.REFERENCE_HEADING}</summary>\n\n` +
        refsHtml +
        "\n</details>";
    return [...blocks.slice(0, headingIndex), details];
}
//# sourceMappingURL=references.js.map