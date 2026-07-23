/**
 * Math normalization + rendering.
 *
 * Ported from `tools/pdf_to_html.py` (`normalize_math`, `normalize_display_math`,
 * `render_math_block`, `textual_math_fixes`). Inline `$...$` spans and `` ```math ``
 * blocks are emitted as `<span class="math-tex">` carrying the *raw* (escaped) LaTeX;
 * KaTeX renders them in the Webview. This conservative, span-based approach avoids the
 * auto-render pitfall where plain citation brackets `[12]` get mistaken for math.
 */

import { escapeHtml } from "../htmlEscape";

/** Known LaTeX sub-expression fixes (docling tends to emit these forms). */
const MATH_REPLACEMENTS: Array<[string, string]> = [
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
const TEXTUAL_MATH_FIXES: Array<[string, string]> = [
  ["∆Gbind", "$\\Delta G_{\\mathrm{bind}}$"],
  ["∆ G bind", "$\\Delta G_{\\mathrm{bind}}$"],
  ["Gcomplex", "$G_{\\mathrm{complex}}$"],
  ["Gliposome", "$G_{\\mathrm{liposome}}$"],
  ["Gprotein", "$G_{\\mathrm{protein}}$"],
];

function replaceAll(text: string, find: string, replace: string): string {
  return text.split(find).join(replace);
}

/**
 * KaTeX (unlike LaTeX) requires a base atom before `^`/`_`. The common degree idiom
 * `10\,^\circ\text{C}` puts a spacing macro — not a base — directly before `^`, so KaTeX
 * rejects it and renders the whole span as red raw source. Inserting an empty group makes
 * `\,^\circ` → `\,{}^\circ`: identical output, but valid. Only spacing macros are matched,
 * so a real base like `10^\circ` (→ "10°") is left untouched.
 */
function fixBaselessScripts(expr: string): string {
  return expr.replace(/(\\[,;:!]|\\quad|\\qquad|\\ )(\s*)([\^_])/g, "$1$2{}$3");
}

/**
 * Unicode symbols that are math-mode-only in KaTeX. Inside `\text{…}` (text mode) they
 * error and render as red raw source — the classic case is the middle dot in `\text{Pa·s}`
 * (KaTeX maps `·` to `\cdotp`, a math command). The fix breaks the text run at each such
 * character and drops in its math command, so `\text{Pa·s}` → `\text{Pa}\cdot\text{s}`.
 */
const TEXT_MODE_UNICODE: Record<string, string> = {
  "·": "\\cdot", "⋅": "\\cdot", "×": "\\times", "÷": "\\div",
  "→": "\\rightarrow", "←": "\\leftarrow", "↔": "\\leftrightarrow",
  "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↦": "\\mapsto",
  "−": "-", "±": "\\pm", "∓": "\\mp",
  "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv",
  "∝": "\\propto", "≪": "\\ll", "≫": "\\gg", "∼": "\\sim",
  "∞": "\\infty", "∂": "\\partial", "∇": "\\nabla", "√": "\\surd",
  "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint", "∈": "\\in", "∉": "\\notin",
  "°": "^\\circ", "′": "'", "″": "''", "∘": "\\circ", "∙": "\\bullet", "•": "\\bullet",
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\varepsilon",
  "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota",
  "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu", "ν": "\\nu", "ξ": "\\xi", "π": "\\pi",
  "ρ": "\\rho", "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon",
  "φ": "\\phi", "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega",
  "Γ": "\\Gamma", "Δ": "\\Delta", "∆": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda",
  "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega",
};

const TEXT_MODE_RE = new RegExp("[" + Object.keys(TEXT_MODE_UNICODE).join("") + "]");

/**
 * Turn a run of would-be `\text{…}` content into a valid mix of `\text{…}` and math: literal
 * stretches stay wrapped in `\text{}`, and each math-mode-only unicode symbol becomes its
 * command. Used both to repair `\text{…}` inside equations and to build multi-line Mermaid
 * labels (see markdownRenderer). Returns a fragment for math context, never wrapped itself.
 */
export function sanitizeTextRun(text: string): string {
  if (!TEXT_MODE_RE.test(text)) {
    return text ? `\\text{${text}}` : "";
  }
  let out = "";
  let buf = "";
  for (const ch of text) {
    const cmd = TEXT_MODE_UNICODE[ch];
    if (cmd !== undefined) {
      if (buf) {
        out += `\\text{${buf}}`;
        buf = "";
      }
      out += cmd;
    } else {
      buf += ch;
    }
  }
  if (buf) {
    out += `\\text{${buf}}`;
  }
  return out;
}

function fixTextModeUnicode(expr: string): string {
  return expr.replace(/\\text\{([^{}]*)\}/g, (_m, inner: string) => sanitizeTextRun(inner));
}

export function normalizeMath(expr: string): string {
  let out = fixTextModeUnicode(fixBaselessScripts(expr.trim()));
  for (const [oldStr, newStr] of MATH_REPLACEMENTS) {
    out = replaceAll(out, oldStr, newStr);
  }
  out = replaceAll(
    out,
    "+ k_{\\mathrm{B}} T\\xi /6\\pi\\eta L",
    "+ \\frac{k_{\\mathrm{B}}T\\xi}{6\\pi\\eta L}"
  );
  out = replaceAll(
    out,
    "+ k_{\\mathrm{B}} T\\xi /6 \\pi\\eta L",
    "+ \\frac{k_{\\mathrm{B}}T\\xi}{6\\pi\\eta L}"
  );
  return out;
}

export function normalizeDisplayMath(expr: string): string {
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

export function renderMathBlock(expr: string): string {
  const normalized = normalizeDisplayMath(expr);
  return (
    '<div class="math-block">' +
    `<span class="math-tex" data-display="true">${escapeHtml(normalized)}</span>` +
    "</div>"
  );
}

/**
 * Render a `$$…$$` display equation (the inner LaTeX, *without* the delimiters) to a
 * display-math span. Identical wrapping to `renderMathBlock` so KaTeX renders it in
 * `displayMode`; the inner LaTeX is HTML-escaped for safe transport and the browser
 * restores it via `textContent` before KaTeX reads it.
 */
export function renderDisplayMath(expr: string): string {
  return renderMathBlock(expr);
}

export function textualMathFixes(text: string): string {
  let out = text;
  for (const [oldStr, newStr] of TEXTUAL_MATH_FIXES) {
    out = replaceAll(out, oldStr, newStr);
  }
  return out;
}
