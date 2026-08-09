// Download the third-party assets the preview and the standalone export need, into
// media/vendor/, so a rendered page works with no network access at all.
//
//   node dist/fetch-vendor.mjs [--force]
//
// The results are committed, so this only has to run when a version below changes.
// Keep the versions in sync with the CDN fallback constants in src/htmlTemplate.ts.
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(ROOT, "media", "vendor");

const KATEX_VERSION = "0.16.11";
const HLJS_VERSION = "11.11.1";
const MERMAID_VERSION = "11";
const KATEX_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist`;
// Freesentation (the 'Presentation' family in media/preview.css).
const FONT_BASE = "https://cdn.jsdelivr.net/gh/projectnoonnu/2404@1.0";

const force = process.argv.includes("--force");

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function save(relPath, buf) {
  const abs = join(VENDOR, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  console.log(`  ${relPath.padEnd(40)} ${(buf.length / 1024).toFixed(0)} KB`);
  return buf.length;
}

/** Skip a download when the file is already there and --force was not passed. */
async function have(relPath) {
  if (force) {
    return false;
  }
  try {
    return (await stat(join(VENDOR, relPath))).size > 0;
  } catch {
    return false;
  }
}

/**
 * Keep only the woff2 alternative in every `src:` list. KaTeX ships woff2 + woff + ttf for
 * each face; we vendor woff2 alone (universally supported since ~2016), and a leftover
 * url(fonts/….woff) would be a dangling reference in both the webview and the export.
 */
function woff2Only(css) {
  return css.replace(/src:([^;{}]+)/g, (whole, list) => {
    const woff2 = list
      .split(/,(?![^(]*\))/)
      .map((part) => part.trim())
      .filter((part) => part.includes(".woff2"));
    return woff2.length > 0 ? `src:${woff2.join(",")}` : whole;
  });
}

async function main() {
  await mkdir(VENDOR, { recursive: true });
  const manifest = { katex: KATEX_VERSION, highlightjs: HLJS_VERSION, mermaid: MERMAID_VERSION, files: {} };
  const record = async (rel, buf) => {
    manifest.files[rel] = await save(rel, buf);
  };

  console.log("KaTeX stylesheet + fonts");
  const rawCss = (await download(`${KATEX_BASE}/katex.min.css`)).toString("utf8");
  const css = woff2Only(rawCss);
  await record("katex.min.css", Buffer.from(css, "utf8"));

  const fontFiles = [...new Set([...css.matchAll(/url\(\s*fonts\/([^)\s"']+\.woff2)\s*\)/g)].map((m) => m[1]))];
  if (fontFiles.length === 0) {
    throw new Error("no woff2 references found in katex.min.css — the CSS format changed");
  }
  for (const name of fontFiles) {
    const rel = `fonts/${name}`;
    if (await have(rel)) {
      continue;
    }
    await record(rel, await download(`${KATEX_BASE}/fonts/${name}`));
  }

  console.log("Scripts");
  const scripts = [
    ["katex.min.js", `${KATEX_BASE}/katex.min.js`],
    ["highlight.min.js", `https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@${HLJS_VERSION}/build/highlight.min.js`],
    ["mermaid.min.js", `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`],
  ];
  for (const [rel, url] of scripts) {
    await record(rel, await download(url));
  }

  console.log("Fonts (Presentation / Freesentation)");
  for (const rel of ["Freesentation-4Regular.woff2", "Freesentation-7Bold.woff2"]) {
    await record(rel, await download(`${FONT_BASE}/${rel}`));
  }

  await writeFile(join(VENDOR, "vendor.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const total = Object.values(manifest.files).reduce((a, b) => a + b, 0);
  console.log(`\nDone. ${Object.keys(manifest.files).length} files, ${(total / 1024 / 1024).toFixed(1)} MB in media/vendor/.`);
}

main().catch((err) => {
  console.error(`fetch-vendor failed: ${err.message}`);
  process.exit(1);
});
