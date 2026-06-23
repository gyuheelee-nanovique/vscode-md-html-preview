"use strict";
/**
 * HTML escaping / unescaping helpers.
 *
 * Mirrors the behaviour of Python's `html.escape(text, quote=False)` and
 * `html.unescape` as used by `tools/pdf_to_html.py`, so the live preview and the
 * standalone export produce byte-identical text nodes for the same Markdown.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.escapeAttr = escapeAttr;
exports.unescapeHtml = unescapeHtml;
/** Escape `&`, `<`, `>` (quote=false, matching the Python pipeline for text nodes). */
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
/** Escape including quotes, for attribute values. Matches Python `html.escape(quote=True)`. */
function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
// Curated named-entity table. Python's `html.unescape` covers the full HTML5 set (~2000
// names); this covers the entities that realistically appear in docling / translated
// scientific Markdown (basics, Greek letters, common math + typography symbols). Names
// are case-sensitive (&Delta; vs &delta;); a lowercase fallback handles the uppercase
// aliases HTML5 defines for the basics (&AMP;, &COPY;, …).
const NBSP = "\u00A0";
const NAMED_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: NBSP,
    copy: "©", reg: "®", trade: "™", deg: "°", micro: "µ",
    middot: "·", bull: "•", hellip: "…", prime: "′", Prime: "″",
    permil: "‰", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’",
    ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
    times: "×", divide: "÷", minus: "−", plusmn: "±",
    frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
    ne: "≠", le: "≤", ge: "≥", asymp: "≈", equiv: "≡",
    prop: "∝", sim: "∼", infin: "∞", radic: "√", sum: "∑",
    prod: "∏", int: "∫", part: "∂", nabla: "∇", forall: "∀",
    exist: "∃", empty: "∅", isin: "∈", notin: "∉",
    sube: "⊆", supe: "⊇", cap: "∩", cup: "∪",
    larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔",
    rArr: "⇒", lArr: "⇐",
    Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Theta: "Θ",
    Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ",
    Psi: "Ψ", Omega: "Ω",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
    zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
    lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
    rho: "ρ", sigmaf: "ς", sigma: "σ", tau: "τ", upsilon: "υ",
    phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
};
const BASIC_ALIASES = new Set([
    "amp", "lt", "gt", "quot", "apos", "nbsp", "copy", "reg", "trade", "deg",
]);
/** Decode HTML entities (curated named set + numeric), mirroring the pipeline's `html.unescape`. */
function unescapeHtml(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
        if (body[0] === "#") {
            const isHex = body[1] === "x" || body[1] === "X";
            const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
                try {
                    return String.fromCodePoint(code);
                }
                catch {
                    return match;
                }
            }
            return match;
        }
        if (NAMED_ENTITIES[body] !== undefined) {
            return NAMED_ENTITIES[body];
        }
        const lower = body.toLowerCase();
        if (BASIC_ALIASES.has(lower) && NAMED_ENTITIES[lower] !== undefined) {
            return NAMED_ENTITIES[lower];
        }
        return match;
    });
}
//# sourceMappingURL=htmlEscape.js.map