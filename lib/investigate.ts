// Agentic file discovery (Meta Muse Spark tool calling). Before the condition assessment, Spark explores the
// repository at the pinned commit with three read-only tools (list files, search, read lines) and names the files
// that decide each condition: where untrusted input enters, which middleware guards a route, which tools an agent
// exposes. Those files join the numbered listing, so the assessment's citation checks stay exactly as before.
// Bounded: at most 6 rounds and 12 file reads, 24 kB per tool result. Nothing is executed; repository text is data.
import type { Claim, WatchedRepo } from "./schema";
import { readFile, tree } from "./repo";
import { READ_ONLY, UNTRUSTED, sparkTools, type ToolTrace } from "./spark";

export type Investigation = { added: string[]; trace: ToolTrace[]; tokens: number; ms: number; model: string; rationale: string };

const SKIP = /node_modules|\.next\/|dist\/|build\/|\.min\.|(^|\/)\.env|\.pem$|\.key$|\.(png|jpe?g|gif|ico|svg|woff2?|lock)$/i;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|json|ya?ml|toml)$/;

export async function investigate(repo: WatchedRepo, sha: string, claim: Claim, already: string[]): Promise<Investigation | null> {
  if (!claim.conditions.length) return null;
  const prefix = repo.subdir ? repo.subdir + "/" : "";
  const files = (await tree(repo.repo, sha)).filter((e) => e.path.startsWith(prefix) && !SKIP.test(e.path) && (e.size ?? 0) < 300_000).map((e) => e.path);
  const inRepo = new Set(files);
  let reads = 0;
  const run = async (name: string, a: Record<string, unknown>): Promise<string> => {
    if (name === "list_files") {
      const p = String(a.prefix ?? "").replace(/^\/+/, "");
      const out = files.filter((f) => f.startsWith(prefix + p) || f.startsWith(p)).slice(0, 300);
      return out.length ? out.join("\n") : "(no files)";
    }
    if (name === "search") {
      let re: RegExp;
      try { re = new RegExp(String(a.pattern ?? "").slice(0, 200), "i"); } catch { return "error: invalid regex"; }
      const sub = String(a.path_contains ?? "");
      const cands = files.filter((f) => SOURCE.test(f) && (!sub || f.includes(sub))).slice(0, 120);
      const hits: string[] = [];
      for (const f of cands) {
        const t = await readFile(repo.repo, sha, f).catch(() => null);
        if (!t) continue;
        t.split("\n").forEach((l, i) => { if (hits.length < 60 && re.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 160)}`); });
        if (hits.length >= 60) break;
      }
      return hits.join("\n") || "(no matches)";
    }
    if (name === "read_file") {
      const p = String(a.path ?? "");
      if (!inRepo.has(p)) return "error: no such file in this repository";
      if (++reads > 12) return "error: read budget exhausted; call finish now";
      const t = await readFile(repo.repo, sha, p);
      if (t == null) return "error: unreadable";
      const lines = t.split("\n");
      const from = Math.max(1, Number(a.from_line ?? 1)), to = Math.min(lines.length, Number(a.to_line ?? from + 199));
      return lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join("\n");
    }
    return "error: unknown tool";
  };
  const tools = [
    { name: "list_files", description: "List repository files whose path starts with a prefix (empty prefix = all; max 300).", parameters: { type: "object", properties: { prefix: { type: "string" } }, required: ["prefix"], additionalProperties: false } },
    { name: "search", description: "Case-insensitive regex search over source and config files; returns file:line: text (max 60 hits). Optionally restrict to paths containing a substring.", parameters: { type: "object", properties: { pattern: { type: "string" }, path_contains: { type: "string" } }, required: ["pattern"], additionalProperties: false } },
    { name: "read_file", description: "Read numbered lines of one file (default: 200 lines starting at from_line).", parameters: { type: "object", properties: { path: { type: "string" }, from_line: { type: "integer" }, to_line: { type: "integer" } }, required: ["path"], additionalProperties: false } },
  ];
  const finishTool = { name: "finish", description: "Report the repository files that decide the conditions (max 8 paths) with a short rationale.", parameters: { type: "object", properties: { files: { type: "array", items: { type: "string" } }, rationale: { type: "string" } }, required: ["files", "rationale"], additionalProperties: false } };
  const r = await sparkTools<{ files: string[]; rationale: string }>({ name: "investigate", maxSteps: 6, tools, finishTool, run,
    system: `${READ_ONLY}\n${UNTRUSTED}\nYou are investigating whether a repository meets the conditions of a security report. Use the tools to find the code that decides each condition: entry points for untrusted input, routes and their guards, configuration, an agent's tool definitions and permissions, call sites of the affected APIs. Prefer search, then read only what matters. Then call finish with the deciding files. Do not decide the verdict.`,
    user: `REPORT (untrusted): ${claim.summary}\nCONDITIONS:\n${claim.conditions.map((c) => `- ${c.id}: ${c.text}`).join("\n")}\nTECH: ${claim.tech_tags.join(", ")}; PACKAGES: ${claim.packages.map((p) => p.name).join(", ") || "none"}\nREPOSITORY ${repo.repo}${repo.subdir ? ` (only under ${repo.subdir}/)` : ""} at ${sha.slice(0, 7)}: ${files.length} files. Already in the listing: ${already.slice(0, 30).join(", ") || "none"}.` });
  if (!r.out) return { added: [], trace: r.trace, tokens: r.tokens, ms: r.ms, model: r.model, rationale: "investigation ended without a result" };
  const added = [...new Set(r.out.files ?? [])].filter((p) => inRepo.has(p) && !already.includes(p)).slice(0, 8);
  return { added, trace: r.trace, tokens: r.tokens, ms: r.ms, model: r.model, rationale: String(r.out.rationale ?? "").slice(0, 800) };
}
