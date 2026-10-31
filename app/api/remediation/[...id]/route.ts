// Remediation brief as Markdown (download or copy). Read-only; includes only cited lines with ±2 context.
import { env } from "@/lib/env";
import { buildBrief } from "@/lib/remediation";
import { readFile } from "@/lib/repo";
import { store } from "@/lib/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string[] }> }) {
  const { id } = await ctx.params;
  const a = await store.getAssessment(id.map(decodeURIComponent).join("/"));
  if (!a) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const agent = (url.searchParams.get("agent") as "claude" | "codex" | "generic" | null) ?? "generic";
  const f = await store.getFinding(a.finding_id);
  const items = f ? (await Promise.all(f.items.map((i) => store.getItem(i)))).filter((x) => !!x) : [];
  const repoFull = a.repo.split("/").slice(0, 2).join("/");
  const files = [...new Set([...a.locations.map((l) => l.file), ...a.conditions.flatMap((c) => c.evidence.map((e) => e.file))])];
  const fileLines = new Map<string, string[]>();
  for (const file of files.slice(0, 8)) { const t = await readFile(repoFull, a.sha, file).catch(() => null); if (t) fileLines.set(file, t.split("\n")); }
  const md = buildBrief(a, f, items, { agent, appUrl: env.APP_URL, fileLines });
  const download = url.searchParams.get("download") === "1";
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", ...(download ? { "Content-Disposition": `attachment; filename="REMEDIATION-${(f?.ids[0] ?? a.finding_id).replace(/[^A-Za-z0-9.-]/g, "_")}.md"` } : {}) } });
}
