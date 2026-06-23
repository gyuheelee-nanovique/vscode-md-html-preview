/**
 * References folding.
 *
 * The `참고문헌` (References) heading and everything after it is wrapped in a
 * `<details class="references">` element so it can be collapsed on screen and kept
 * open for print, matching the paper HTML pipeline in `tools/pdf_to_html.py`.
 */

export const REFERENCE_HEADING = "참고문헌";

/** A reference list line: `[12] ...` or `12. ...`. */
export const REFERENCE_LINE_RE = /^(?:\[)?\d+\.\s+/;

/**
 * Replace the references heading block (and the blocks after it) with a single
 * `<details>` block. `blocks` are the already-rendered top-level HTML blocks;
 * `headingIndex` is the index of the `참고문헌` heading block.
 */
export function wrapReferences(
  blocks: string[],
  headingIndex: number,
  open: boolean,
  headingLine?: number
): string[] {
  if (headingIndex < 0 || headingIndex >= blocks.length) {
    return blocks;
  }
  const refsHtml = blocks.slice(headingIndex + 1).join("\n\n").trim();
  const openAttr = open ? " open" : "";
  const lineAttr = headingLine !== undefined ? ` data-source-line="${headingLine}"` : "";
  const details =
    `<details class="references" id="references"${openAttr}${lineAttr}>\n` +
    `<summary>${REFERENCE_HEADING}</summary>\n\n` +
    refsHtml +
    "\n</details>";
  return [...blocks.slice(0, headingIndex), details];
}
