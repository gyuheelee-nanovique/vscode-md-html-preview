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

// GFM allows a separator cell to be as short as a single dash, with optional alignment
// colons (`:--`, `--:`, `:-:`). The previous `-{3,}` missed `:--`, so the separator row
// was treated as data and its markers showed up as a visible first table row. The trailing
// group is `*` (not `+`) so single-column tables (`|:--|`) are recognised too.
const TABLE_SEPARATOR_RE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;

export type ColumnAlign = "left" | "center" | "right" | null;

/**
 * Split a pipe row into trimmed cells, dropping all leading/trailing pipes.
 *
 * A `|` is a cell boundary only OUTSIDE inline math and inline code: `$\phi\big|_{\partial
 * \Omega}$`, `$\left.\dfrac{\partial\phi}{\partial n}\right|_{\partial\Omega}$` and
 * `\|x\|` stay inside their cell (a plain `.split("|")` turned each into extra columns).
 * Outside math, the CommonMark escape `\|` yields a literal pipe.
 */
function splitRow(line: string): string[] {
  const s = line.trim();
  const cells: string[] = [];
  let cur = "";
  let inMath = false; // between unescaped `$` … `$` (or `$$` … `$$`)
  let inCode = false; // between backticks
  let dollars = 0;    // 1 or 2: how the current math span was opened
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      // Escaped character: outside math `\|` is a literal pipe; inside math keep the
      // backslash (it is LaTeX: `\|`, `\$`, …).
      if (!inMath && !inCode && s[i + 1] === "|") { cur += "|"; i += 1; continue; }
      cur += ch + s[i + 1];
      i += 1;
      continue;
    }
    if (ch === "`" && !inMath) { inCode = !inCode; cur += ch; continue; }
    if (ch === "$" && !inCode) {
      if (!inMath) {
        dollars = s[i + 1] === "$" ? 2 : 1;
        inMath = true;
        cur += dollars === 2 ? "$$" : "$";
        i += dollars - 1;
        continue;
      }
      if (dollars === 2 && s[i + 1] === "$") { inMath = false; cur += "$$"; i += 1; continue; }
      if (dollars === 1) { inMath = false; cur += "$"; continue; }
      cur += ch;
      continue;
    }
    if (ch === "|" && !inMath && !inCode) { cells.push(cur); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur);
  // Drop the empty cells that leading / trailing pipes produce (`| a | b |` -> a, b).
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** Per-column alignment encoded by the separator row's colons. */
export function parseAlignments(line: string): ColumnAlign[] {
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

export function isSeparatorRow(line: string): boolean {
  return TABLE_SEPARATOR_RE.test(line.trim());
}

export function parsePipeTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  lines.forEach((line, idx) => {
    if (idx === 1 && isSeparatorRow(line)) {
      return;
    }
    rows.push(splitRow(line));
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
function cell(tag: string, inner = "", attrs: CellAttrs = {}, align: ColumnAlign = null): string {
  let rendered = "";
  if (attrs.rowspan !== undefined) {
    rendered += ` rowspan="${escapeAttr(String(attrs.rowspan))}"`;
  }
  if (attrs.colspan !== undefined) {
    rendered += ` colspan="${escapeAttr(String(attrs.colspan))}"`;
  }
  if (align) {
    rendered += ` class="ta-${align}"`;
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
  const align =
    lines.length > 1 && isSeparatorRow(lines[1]) ? parseAlignments(lines[1]) : [];
  const head = rows[0];
  const body = rows.slice(1);
  const parts: string[] = ['<div class="table-scroll"><table>'];
  if (caption) {
    parts.push(`<caption>${inline(caption)}</caption>`);
  }
  parts.push(
    "<thead>" + tr(head.map((c, i) => cell("th", inline(c), {}, align[i] ?? null))) + "</thead>"
  );
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
