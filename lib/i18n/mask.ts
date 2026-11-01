// Protect technical identifiers from translation. Matches are wrapped in <span class="notranslate"> (honoured by
// Google Cloud Translation with format=html) and restored afterwards. Pure; unit-tested.
const PATTERNS: RegExp[] = [
  /`[^`\n]+`/g,                                                      // inline code
  /\b(CVE-\d{4}-\d{4,7}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|OSV-\d{4}-\d+|PYSEC-\d{4}-\d+|RUSTSEC-\d{4}-\d+)\b/gi, // advisory ids
  /https?:\/\/[^\s)]+/g,                                             // urls
  /(?:^|[\s(])((?:[\w.@-]+\/)+[\w.@-]+(?::\d+)?)(?=[\s,.;)]|$)/g,    // paths like src/app/x.ts:12 or @scope/pkg
  /\b[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|py|json|ya?ml|toml|md|lock)(?::\d+)?\b/g, // file names
  /\b\d+\.\d+\.\d+(?:[-+][\w.]+)?\b/g,                               // semver
  /\b(?:>=|<=|<|>|==|\^|~)\s?\d[\w.-]*/g,                            // version ranges
  /\b[a-z][a-zA-Z0-9]*_[a-zA-Z0-9_]+\b/g,                            // snake_case identifiers
  /\b[A-Za-z]+[A-Z][A-Za-z0-9]*\(\)/g,                               // camelCase calls
];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Returns HTML with protected spans; `keep` adds literal strings (package names, file paths) to protect. */
export function mask(text: string, keep: string[] = []): { html: string; tokens: string[] } {
  const tokens: string[] = [];
  const spans: { s: number; e: number }[] = [];
  const add = (s: number, e: number) => { if (e > s && !spans.some((x) => s < x.e && e > x.s)) spans.push({ s, e }); };
  for (const k of keep.filter((k) => k.length >= 3)) { let i = 0; while ((i = text.indexOf(k, i)) >= 0) { add(i, i + k.length); i += k.length; } }
  for (const re of PATTERNS) for (const m of text.matchAll(re)) { const full = m[0]; const inner = m[1] && re.source.startsWith("(?:^|[\\s(])") ? m[1] : full; const off = full.indexOf(inner); add(m.index! + off, m.index! + off + inner.length); }
  spans.sort((a, b) => a.s - b.s);
  let out = "", last = 0;
  for (const sp of spans) { out += esc(text.slice(last, sp.s)); tokens.push(text.slice(sp.s, sp.e)); out += `<span class="notranslate">${esc(text.slice(sp.s, sp.e))}</span>`; last = sp.e; }
  out += esc(text.slice(last));
  return { html: out, tokens };
}

/** Converts translated HTML back to plain text with the protected tokens restored verbatim. */
export function unmask(html: string, tokens: string[]): string {
  let i = 0;
  const text = html.replace(/<span class="notranslate">([\s\S]*?)<\/span>/g, () => tokens[i++] ?? "");
  return unesc(text.replace(/<[^>]+>/g, ""));
}
