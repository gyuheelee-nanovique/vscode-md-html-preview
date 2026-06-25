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

import { escapeAttr } from "../htmlEscape";

export type InlineRenderer = (text: string) => string;

const TABLE_SEPARATOR_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;

export function parsePipeTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  lines.forEach((line, idx) => {
    const stripped = line.trim();
    if (idx === 1 && TABLE_SEPARATOR_RE.test(stripped)) {
      return;
    }
    // Strip ALL leading/trailing pipes (Python str.strip('|')), not just one per side.
    rows.push(stripped.replace(/^\|+/, "").replace(/\|+$/, "").split("|").map((c) => c.trim()));
  });
  return rows;
}

export function isSimulationTable(rows: string[][]): boolean {
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

interface CellAttrs {
  rowspan?: number;
  colspan?: number;
}

/** Build a `<th>`/`<td>`. `inner` is already-rendered, safe inline HTML (see `inline`). */
function cell(tag: string, inner = "", attrs: CellAttrs = {}): string {
  let rendered = "";
  if (attrs.rowspan !== undefined) {
    rendered += ` rowspan="${escapeAttr(String(attrs.rowspan))}"`;
  }
  if (attrs.colspan !== undefined) {
    rendered += ` colspan="${escapeAttr(String(attrs.colspan))}"`;
  }
  return `<${tag}${rendered}>${inner}</${tag}>`;
}

function tr(cells: string[]): string {
  return "<tr>" + cells.join("") + "</tr>";
}

function renderSimulationTable(
  rows: string[][],
  caption: string | null,
  inline: InlineRenderer
): string {
  const data = rows.slice(3).filter((row) => row.length >= 12);
  const parts: string[] = ['<div class="table-scroll"><table class="sim-table">'];
  if (caption) {
    parts.push(`<caption>${inline(caption)}</caption>`);
  }
  parts.push("<thead>");
  parts.push(
    '<tr><th rowspan="3"></th><th rowspan="3">리포솜 크기<br>(시스템)</th>' +
      '<th colspan="9">분자 수</th><th rowspan="3">시뮬레이션 수</th></tr>'
  );
  parts.push('<tr><th colspan="5">리포솜</th><th colspan="4">혈장 단백질</th></tr>');
  parts.push(
    "<tr><th>DOPC</th><th>DOPE</th><th>DOPG</th><th>DOTAP</th>" +
      "<th>Chol.</th><th>SA</th><th>IgG</th><th>C3</th><th>FG</th></tr>"
  );
  parts.push("</thead>");
  parts.push("<tbody>");
  for (const row of data) {
    const slice = row.slice(0, 12);
    const label = slice[0] ?? "";
    const size = slice[1] ?? "";
    const values = slice.slice(2);
    parts.push(
      tr([cell("td", inline(label)), cell("td", inline(size)), ...values.map((v) => cell("td", inline(v)))])
    );
  }
  parts.push("</tbody>");
  parts.push("</table></div>");
  return parts.join("\n");
}

export function renderTable(
  lines: string[],
  caption: string | null,
  inline: InlineRenderer
): string {
  const rows = parsePipeTable(lines);
  if (rows.length === 0) {
    return "";
  }
  if (isSimulationTable(rows)) {
    return renderSimulationTable(rows, caption, inline);
  }
  const head = rows[0];
  const body = rows.slice(1);
  const parts: string[] = ['<div class="table-scroll"><table>'];
  if (caption) {
    parts.push(`<caption>${inline(caption)}</caption>`);
  }
  parts.push("<thead>" + tr(head.map((c) => cell("th", inline(c)))) + "</thead>");
  if (body.length > 0) {
    parts.push("<tbody>");
    for (const row of body) {
      parts.push(tr(row.map((c) => cell("td", inline(c)))));
    }
    parts.push("</tbody>");
  }
  parts.push("</table></div>");
  return parts.join("\n");
}
