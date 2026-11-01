// Read-only repository access via the GitHub contents/trees API. Nothing is cloned or executed.
import semver from "semver";
import { env, hasGitHubApp } from "./env";
import { installationToken } from "./github-app";
import type { WatchedRepo } from "./schema";
import { kv, store } from "./store";

// Trees and file contents are immutable per commit sha: cache them (store-backed) so each is fetched once.
// Values are wrapped as { v } because Upstash Redis auto-parses stored strings that look like JSON
// (a cached package-lock.json would otherwise come back as an object, not text).
const memo = new Map<string, unknown>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `c2:${key}`;
  if (memo.has(k)) return memo.get(k) as T;
  const hit = await kv.get<{ v: T }>(k);
  if (hit && typeof hit === "object" && "v" in hit) { memo.set(k, hit.v); return hit.v; }
  const v = await fn();
  memo.set(k, v);
  if (v !== null && v !== undefined) await kv.set(k, { v });
  return v;
}

const GH = "https://api.github.com";
// Auth per repository: the GitHub App installation token when the watched repo was connected through the App,
// otherwise the read-only PAT (public demo fixtures). Installation lookups are memoised for a minute.
let repoInstMemo: { at: number; map: Map<string, number> } | null = null;
async function installationFor(repo: string): Promise<number | null> {
  if (!repoInstMemo || Date.now() - repoInstMemo.at > 60e3) {
    const map = new Map<string, number>();
    for (const w of await store.listRepos()) if (w.installation_id) map.set(w.repo, w.installation_id);
    repoInstMemo = { at: Date.now(), map };
  }
  return repoInstMemo.map.get(repo) ?? null;
}
export const forgetInstallations = () => { repoInstMemo = null; };
async function hdr(repo: string): Promise<Record<string, string>> {
  const base: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "ArgusWatch/0.1" };
  const inst = hasGitHubApp() ? await installationFor(repo) : null;
  if (inst) { try { return { ...base, Authorization: `Bearer ${await installationToken(inst)}` }; } catch { /* fall back to PAT */ } }
  return env.GITHUB_TOKEN ? { ...base, Authorization: `Bearer ${env.GITHUB_TOKEN}` } : base;
}

export async function headSha(repo: string, branch: string): Promise<string> {
  const r = await fetch(`${GH}/repos/${repo}/commits/${encodeURIComponent(branch)}`, { headers: await hdr(repo) });
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${repo}@${branch}`);
  return ((await r.json()) as { sha: string }).sha;
}

export type TreeEntry = { path: string; type: "blob" | "tree"; size?: number; sha?: string };
export async function tree(repo: string, sha: string): Promise<TreeEntry[]> {
  return cached(`gh:tree:${repo}:${sha}`, async () => {
  const r = await fetch(`${GH}/repos/${repo}/git/trees/${sha}?recursive=1`, { headers: await hdr(repo) });
  if (!r.ok) throw new Error(`GitHub tree ${r.status}${r.status === 403 ? " (unauthenticated rate limit is 60/h; set GITHUB_TOKEN)" : ""}`);
  const j = (await r.json()) as { tree: TreeEntry[]; truncated: boolean };
  return j.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, type: e.type, size: e.size, sha: e.sha }));
  });
}

export async function readFile(repo: string, sha: string, path: string): Promise<string | null> {
  return cached(`gh:file:${repo}:${sha}:${path}`, async () => {
  const r = await fetch(`${GH}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`, { headers: { ...(await hdr(repo)), Accept: "application/vnd.github.raw+json" } });
  if (r.status === 403 || r.status === 429) throw new Error(`GitHub ${r.status} (rate limit?) reading ${path}`);
  if (!r.ok) return null;
  return await r.text();
  });
}

// ---- Lockfile parsing (npm first; pnpm/yarn/pypi best-effort) --------------
export type Pkg = { ecosystem: string; name: string; version: string; source_file: string };

export function parseLockfiles(files: { path: string; text: string }[]): Pkg[] {
  const out: Pkg[] = [];
  for (const f of files) {
    const base = f.path.split("/").pop()!;
    try {
      if (base === "package-lock.json") {
        const j = JSON.parse(f.text) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
        for (const [k, v] of Object.entries(j.packages ?? {})) { if (k.startsWith("node_modules/") && v.version) out.push({ ecosystem: "npm", name: k.replace(/^.*node_modules\//, ""), version: v.version, source_file: f.path }); }
        if (!j.packages) for (const [k, v] of Object.entries(j.dependencies ?? {})) if (v.version) out.push({ ecosystem: "npm", name: k, version: v.version, source_file: f.path });
      } else if (base === "pnpm-lock.yaml") {
        for (const m of f.text.matchAll(/^\s{2}'?(\/?@?[^'\s:@]+(?:\/[^'\s:@]+)?)@([^'\s:(]+)/gm)) out.push({ ecosystem: "npm", name: m[1].replace(/^\//, ""), version: m[2], source_file: f.path });
      } else if (base === "yarn.lock") {
        for (const m of f.text.matchAll(/^"?(@?[^@\s"]+)@[^\n]*\n\s+version:?\s+"?([^"\s]+)"?/gm)) out.push({ ecosystem: "npm", name: m[1], version: m[2], source_file: f.path });
      } else if (base === "requirements.txt") {
        for (const m of f.text.matchAll(/^([A-Za-z0-9_.-]+)==([0-9][^\s;#]*)/gm)) out.push({ ecosystem: "pypi", name: m[1].toLowerCase(), version: m[2], source_file: f.path });
      } else if (base === "package.json") {
        const j = JSON.parse(f.text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        for (const [k, v] of Object.entries({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) })) { const mv = semver.minVersion(v)?.version; if (mv) out.push({ ecosystem: "npm", name: k, version: mv, source_file: `${f.path} (declared range ${v}; resolved version unknown)` }); }
      }
    } catch { /* skip unparsable lockfile */ }
  }
  // Prefer lockfile entries over package.json declarations
  const seen = new Set<string>();
  return out.sort((a, b) => Number(a.source_file.includes("package.json")) - Number(b.source_file.includes("package.json")))
    .filter((p) => { const k = `${p.ecosystem}:${p.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "requirements.txt", "package.json"];
export const CONFIG_FILES = /(^|\/)(next\.config\.(js|mjs|ts)|vercel\.json|Dockerfile|docker-compose\.ya?ml|fly\.toml|render\.yaml|netlify\.toml|nginx\.conf|\.env\.example|middleware\.(ts|js)|proxy\.(ts|js)|tsconfig\.json|serverless\.ya?ml|app\.yaml|wrangler\.toml)$/;

export function techTags(pkgs: Pkg[], paths: string[]): string[] {
  const t = new Set<string>();
  const has = (n: string) => pkgs.some((p) => p.name === n);
  if (has("next")) t.add("next.js"); if (has("express")) t.add("express"); if (has("react")) t.add("react");
  if (has("fastify")) t.add("fastify"); if (has("axios")) t.add("axios"); if (has("jsonwebtoken") || has("jose")) t.add("jwt");
  if (pkgs.some((p) => /^@modelcontextprotocol\//.test(p.name))) t.add("mcp");
  if (has("openai") || has("@openai/agents")) t.add("openai-sdk"); if (has("langchain") || has("@langchain/core")) t.add("langchain");
  if (has("@anthropic-ai/sdk")) t.add("anthropic-sdk");
  if (paths.some((p) => /(^|\/)Dockerfile$/.test(p))) t.add("docker");
  if (paths.some((p) => p.startsWith(".github/workflows/"))) t.add("github-actions");
  if (paths.some((p) => /(^|\/)vercel\.json$/.test(p))) t.add("vercel");
  if (paths.some((p) => /(^|\/)(middleware|proxy)\.(ts|js)$/.test(p))) t.add("next-middleware");
  return [...t];
}

/** Refresh the cached stack summary when the head sha changed. */
const inSub = (w: { subdir?: string }, p: string) => !w.subdir || p.startsWith(w.subdir.replace(/\/$/, "") + "/");
const depth = (w: { subdir?: string }, p: string) => p.split("/").length - (w.subdir ? w.subdir.replace(/\/$/, "").split("/").length : 0);

export async function refreshRepo(w: WatchedRepo): Promise<WatchedRepo> {
  const sha = await headSha(w.repo, w.default_branch);
  if (sha === w.sha && w.refreshed_at) return w;
  const entries = (await tree(w.repo, sha)).filter((e) => inSub(w, e.path));
  const lockPaths = entries.filter((e) => LOCKFILES.includes(e.path.split("/").pop()!) && depth(w, e.path) <= 3).map((e) => e.path);
  const files = (await Promise.all(lockPaths.map(async (p) => ({ path: p, text: (await readFile(w.repo, sha, p)) ?? "" })))).filter((f) => f.text);
  const packages = parseLockfiles(files);
  return { ...w, sha, packages, tech_tags: techTags(packages, entries.map((e) => e.path)), refreshed_at: new Date().toISOString() };
}

// ---- Version-in-range, computed in code (never by the model) --------------
/** ranges: GHSA-style strings like ">= 14.0.0, < 14.2.25" or OSV tuples. */
export function versionInRanges(version: string, ranges: string[]): boolean | null {
  const v = semver.coerce(version, { includePrerelease: true })?.version ?? version;
  if (!semver.valid(v)) return null;
  let decided = false;
  for (const r of ranges) {
    const rng = r.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!semver.validRange(rng)) continue;
    decided = true;
    if (semver.satisfies(v, rng, { includePrerelease: true })) return true;
  }
  return decided ? false : null;
}

// ---- Locate: candidate files for analysis (read-only) ---------------------
export async function candidateFiles(repo: string, sha: string, pkgNames: string[], extraTerms: string[], subdir = ""): Promise<{ path: string; text: string }[]> {
  const entries = (await tree(repo, sha)).filter((e) => inSub({ subdir }, e.path));
  const code = entries.filter((e) => (/\.(ts|tsx|js|jsx|mjs|cjs|py|json|ya?ml|toml|conf)$/.test(e.path) || CONFIG_FILES.test(e.path)) && !/node_modules|\.next\/|dist\/|build\/|\.min\./.test(e.path) && (e.size ?? 0) < 200_000);
  const picked = new Set<string>();
  for (const e of code) if (CONFIG_FILES.test(e.path) || LOCKFILES.includes(e.path.split("/").pop()!)) picked.add(e.path);
  // Read source files (bounded) and keep those that import/mention the packages or terms
  const terms = [...pkgNames, ...extraTerms].filter(Boolean).map((t) => t.toLowerCase());
  const src = code.filter((e) => /\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(e.path) && !picked.has(e.path)).slice(0, 150);
  const texts = await Promise.all(src.map(async (e) => ({ path: e.path, text: (await readFile(repo, sha, e.path)) ?? "" })));
  const hits = texts.filter((f) => { const l = f.text.toLowerCase(); return terms.some((t) => l.includes(`'${t}`) || l.includes(`"${t}`) || l.includes(`${t}/`) || l.includes(t)); }).slice(0, 25);
  const cfg = await Promise.all([...picked].map(async (p) => ({ path: p, text: (await readFile(repo, sha, p)) ?? "" })));
  return [...cfg, ...hits].filter((f) => f.text).map((f) => ({ path: f.path, text: f.text.slice(0, 40000) }));
}
