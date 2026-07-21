"use strict";
/**
 * Pipe-table rendering, including the docling "simulation" table special case.
 *
 * Ported from `tools/pdf_to_html.py` (`parse_pipe_table`, `is_simulation_table`,
 * `render_simulation_table`, `render_table`, `cell`, `tr`). Wide tables are wrapped
 * in `.table-scroll` so they scroll horizontally instead of overflowing the viewport.
 *
 * `inline` is injected by the renderer (already bound to the active `keepLinks`
 * setting) and is only used for the optional `<caption>` text — data cells are escaped
 * verbatim, matching the Python pipeline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAlignments = parseAlignments;
exports.isSeparatorRow = isSeparatorRow;
exports.parsePipeTable = parsePipeTable;
exports.isSimulationTable = isSimulationTable;
exports.renderTable = renderTable;
const htmlEscape_1 = require("../htmlEscape");
// GFM allows a separator cell to be as short as a single dash, with optional alignment
// colons (`:--`, `--:`, `:-:`). The previous `-{3,}` missed `:--`, so the separator row
// was treated as data and its markers showed up as a visible first table row. The trailing
// group is `*` (not `+`) so single-column tables (`|:--|`) are recognised too.
const TABLE_SEPARATOR_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
/** Split a pipe row into trimmed cells, dropping all leading/trailing pipes. */
function splitRow(line) {
    return line
        .trim()
        .replace(/^\|+/, "")
        .replace(/\|+$/, "")
        .split("|")
        .map((c) => c.trim());
}
/** Per-column alignment encoded by the separator row's colons. */
function parseAlignments(line) {
    return splitRow(line).map((c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) {
            return "center";
        }
        if (right) {
            return "right";
        }
        if (left) {
            return "left";
        }
        return null;
    });
}
function isSeparatorRow(line) {
    return TABLE_SEPARATOR_RE.test(line.trim());
}
function parsePipeTable(lines) {
    const rows = [];
    lines.forEach((line, idx) => {
        if (idx === 1 && isSeparatorRow(line)) {
            return;
        }
        rows.push(splitRow(line));
    });
    return rows;
}
function isSimulationTable(rows) {
    if (rows.length < 6) {
        return false;
    }
    const flat = rows
        .slice(0, 4)
        .map((row) => row.join(" "))
        .join(" ");
    const required = ["DOPC", "DOPE", "DOPG", "DOTAP", "Chol.", "SA", "IgG", "C3", "FG"];
    const hasAll = required.every((token) => flat.includes(token));
    const hasSim = rows.slice(0, 2).some((row) => row.length > 0 && row[row.length - 1].includes("시뮬레이션"));
    return hasAll && hasSim;
}
/** Build a `<th>`/`<td>`. `inner` is already-rendered, safe inline HTML (see `inline`). */
function cell(tag, inner = "", attrs = {}, align = null) {
    let rendered = "";
    if (attrs.rowspan !== undefined) {
        rendered += ` rowspan="${(0, htmlEscape_1.escapeAttr)(String(attrs.rowspan))}"`;
    }
    if (attrs.colspan !== undefined) {
        rendered += ` colspan="${(0, htmlEscape_1.escapeAttr)(String(attrs.colspan))}"`;
    }
    if (align) {
        rendered += ` class="ta-${align}"`;
    }
    return `<${tag}${rendered}>${inner}</${tag}>`;
}
function tr(cells) {
    return "<tr>" + cells.join("") + "</tr>";
}
function renderSimulationTable(rows, caption, inline) {
    const data = rows.slice(3).filter((row) => row.length >= 12);
    const parts = ['<div class="table-scroll"><table class="sim-table">'];
    if (caption) {
        parts.push(`<caption>${inline(caption)}</caption>`);
    }
    parts.push("<thead>");
    parts.push('<tr><th rowspan="3"></th><th rowspan="3">리포솜 크기<br>(시스템)</th>' +
        '<th colspan="9">분자 수</th><th rowspan="3">시뮬레이션 수</th></tr>');
    parts.push('<tr><th colspan="5">리포솜</th><th colspan="4">혈장 단백질</th></tr>');
    parts.push("<tr><th>DOPC</th><th>DOPE</th><th>DOPG</th><th>DOTAP</th>" +
        "<th>Chol.</th><th>SA</th><th>IgG</th><th>C3</th><th>FG</th></tr>");
    parts.push("</thead>");
    parts.push("<tbody>");
    for (const row of data) {
        const slice = row.slice(0, 12);
        const label = slice[0] ?? "";
        const size = slice[1] ?? "";
        const values = slice.slice(2);
        parts.push(tr([cell("td", inline(label)), cell("td", inline(size)), ...values.map((v) => cell("td", inline(v)))]));
    }
    parts.push("</tbody>");
    parts.push("</table></div>");
    return parts.join("\n");
}
function renderTable(lines, caption, inline) {
    const rows = parsePipeTable(lines);
    if (rows.length === 0) {
        return "";
    }
    if (isSimulationTable(rows)) {
        return renderSimulationTable(rows, caption, inline);
    }
    const align = lines.length > 1 && isSeparatorRow(lines[1]) ? parseAlignments(lines[1]) : [];
    const head = rows[0];
    const body = rows.slice(1);
    const parts = ['<div class="table-scroll"><table>'];
    if (caption) {
        parts.push(`<caption>${inline(caption)}</caption>`);
    }
    parts.push("<thead>" + tr(head.map((c, i) => cell("th", inline(c), {}, align[i] ?? null))) + "</thead>");
    if (body.length > 0) {
        parts.push("<tbody>");
        for (const row of body) {
            parts.push(tr(row.map((c, i) => cell("td", inline(c), {}, align[i] ?? null))));
        }
        parts.push("</tbody>");
    }
    parts.push("</table></div>");
    return parts.join("\n");
}
//# sourceMappingURL=tables.js.map