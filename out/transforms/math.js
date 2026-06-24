"use strict";
/**
 * Math normalization + rendering.
 *
 * Ported from `tools/pdf_to_html.py` (`normalize_math`, `normalize_display_math`,
 * `render_math_block`, `textual_math_fixes`). Inline `$...$` spans and `` ```math ``
 * blocks are emitted as `<span class="math-tex">` carrying the *raw* (escaped) LaTeX;
 * KaTeX renders them in the Webview. This conservative, span-based approach avoids the
 * auto-render pitfall where plain citation brackets `[12]` get mistaken for math.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMath = normalizeMath;
exports.normalizeDisplayMath = normalizeDisplayMath;
exports.renderMathBlock = renderMathBlock;
exports.renderDisplayMath = renderDisplayMath;
exports.textualMathFixes = textualMathFixes;
const htmlEscape_1 = require("../htmlEscape");
/** Known LaTeX sub-expression fixes (docling tends to emit these forms). */
const MATH_REPLACEMENTS = [
    ["R_{L-out}", "R_{L\\text{-out}}"],
    ["R_{S-out}", "R_{S\\text{-out}}"],
    ["D_{PBC}", "D_{\\mathrm{PBC}}"],
    ["k_B", "k_{\\mathrm{B}}"],
    ["G_{complex, liposome, or protein}", "G_{\\mathrm{complex,\\,liposome,\\,or\\,protein}}"],
    ["E_{MM}", "E_{\\mathrm{MM}}"],
    ["G_{solvation}", "G_{\\mathrm{solvation}}"],
    ["E_{vdW}", "E_{\\mathrm{vdW}}"],
    ["E_{elec}", "E_{\\mathrm{elec}}"],
    ["E_{bond}", "E_{\\mathrm{bond}}"],
    ["E_{angle}", "E_{\\mathrm{angle}}"],
    ["E_{dihedral}", "E_{\\mathrm{dihedral}}"],
    ["G_{polar}", "G_{\\mathrm{polar}}"],
    ["G_{nonpolar}", "G_{\\mathrm{nonpolar}}"],
];
/** Plain-text → inline-math fixes applied to body text before math scanning. */
const TEXTUAL_MATH_FIXES = [
    ["∆Gbind", "$\\Delta G_{\\mathrm{bind}}$"],
    ["∆ G bind", "$\\Delta G_{\\mathrm{bind}}$"],
    ["Gcomplex", "$G_{\\mathrm{complex}}$"],
    ["Gliposome", "$G_{\\mathrm{liposome}}$"],
    ["Gprotein", "$G_{\\mathrm{protein}}$"],
];
function replaceAll(text, find, replace) {
    return text.split(find).join(replace);
}
function normalizeMath(expr) {
    let out = expr.trim();
    for (const [oldStr, newStr] of MATH_REPLACEMENTS) {
        out = replaceAll(out, oldStr, newStr);
    }
    out = replaceAll(out, "+ k_{\\mathrm{B}} T\\xi /6\\pi\\eta L", "+ \\frac{k_{\\mathrm{B}}T\\xi}{6\\pi\\eta L}");
    out = replaceAll(out, "+ k_{\\mathrm{B}} T\\xi /6 \\pi\\eta L", "+ \\frac{k_{\\mathrm{B}}T\\xi}{6\\pi\\eta L}");
    return out;
}
function normalizeDisplayMath(expr) {
    let out = normalizeMath(expr);
    out = out.replace(/\\label\{[^}]*\}/g, "").trim();
    out = out.replace(/\\begin\{equation\*?\}|\\end\{equation\*?\}/g, "").trim();
    out = out.replace(/\\begin\{align\*?\}/g, "\\begin{aligned}");
    out = out.replace(/\\end\{align\*?\}/g, "\\end{aligned}");
    out = out.replace(/\\begin\{gather\*?\}/g, "\\begin{gathered}");
    out = out.replace(/\\end\{gather\*?\}/g, "\\end{gathered}");
    if (!out.includes("\\begin{") && (out.includes("&") || out.includes("\\\\"))) {
        out = "\\begin{aligned}\n" + out + "\n\\end{aligned}";
    }
    return out;
}
function renderMathBlock(expr) {
    const normalized = normalizeDisplayMath(expr);
    return ('<div class="math-block">' +
        `<span class="math-tex" data-display="true">${(0, htmlEscape_1.escapeHtml)(normalized)}</span>` +
        "</div>");
}
/**
 * Render a `$$…$$` display equation (the inner LaTeX, *without* the delimiters) to a
 * display-math span. Identical wrapping to `renderMathBlock` so KaTeX renders it in
 * `displayMode`; the inner LaTeX is HTML-escaped for safe transport and the browser
 * restores it via `textContent` before KaTeX reads it.
 */
function renderDisplayMath(expr) {
    return renderMathBlock(expr);
}
function textualMathFixes(text) {
    let out = text;
    for (const [oldStr, newStr] of TEXTUAL_MATH_FIXES) {
        out = replaceAll(out, oldStr, newStr);
    }
    return out;
}
//# sourceMappingURL=math.js.map