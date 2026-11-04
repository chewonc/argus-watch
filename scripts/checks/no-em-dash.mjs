// Guard: SaveBell's own user-facing copy must not contain em dashes (U+2014, also written as —).
// Scans app/, components/ and lib/ (UI strings, translation dictionaries, labels) with comments stripped, so code
// comments, third-party data and stored evidence are not affected. Exit code 1 lists offending lines.
// Usage: node scripts/checks/no-em-dash.mjs   (also run from tests/em-dash.test.ts)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components", "lib"];
const SKIP = /(^|[\\/])(sources|feasibility)([\\/]|$)/; // raw feed parsers and fixtures handle third-party text
const walk = (d) => readdirSync(d).flatMap((x) => { const p = join(d, x); return statSync(p).isDirectory() ? (SKIP.test(p) ? [] : walk(p)) : /\.(ts|tsx)$/.test(x) ? [p] : []; });

/** Remove // and /* *\/ comments but keep strings, template literals and JSX text intact (line numbers preserved). */
export function stripComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "/" && !/[\w)\]"']\s*$/.test(out.slice(-1)) ) { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); const chunk = src.slice(i, e < 0 ? src.length : e + 2); out += chunk.replace(/[^\n]/g, ""); i = e < 0 ? src.length : e + 2; continue; }
    // JSX comments {/* ... */} are handled by the block-comment branch above
    out += c; i++;
  }
  return out;
}

export function findEmDashes(root = process.cwd()) {
  const hits = [];
  for (const r of ROOTS) for (const f of walk(join(root, r))) {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    lines.forEach((l, i) => { if (l.includes("—") || /\\u2014/i.test(l)) hits.push(`${relative(root, f)}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("no-em-dash.mjs")) {
  const hits = findEmDashes();
  if (hits.length) { console.error(`Em dashes in user-facing copy (${hits.length}):\n${hits.join("\n")}`); process.exit(1); }
  console.log("no em dashes in user-facing copy");
}
