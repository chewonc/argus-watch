// Manual override (read-only tool contract): analyze one advisory id against the watched repos now.
// Also the agent-callable endpoint: same JSON any function-calling agent can consume.
import { isAdminAuth } from "@/lib/env";
import { sha } from "@/lib/dedup";
import { ingest, processFinding } from "@/lib/pipeline";
import { osvGet } from "@/lib/sources/ghsa";
import { store } from "@/lib/store";

export const maxDuration = 300;

export async function POST(req: Request) {
  // Fail closed: without a configured ADMIN_TOKEN nobody can trigger on-demand analysis.
  if (!isAdminAuth(req.headers.get("authorization"))) return new Response("unauthorized", { status: 401 });
  const { advisory_id } = (await req.json()) as { advisory_id: string };
  const v = await osvGet(advisory_id);
  if (!v) return Response.json({ error: "advisory not found in OSV" }, { status: 404 });
  const discovered_at = new Date().toISOString();
  const ids = [...new Set([v.id, ...(v.aliases ?? [])].map((x) => x.toUpperCase()))];
  const ranges = (v.affected ?? []).map((a) => `${a.package?.ecosystem}/${a.package?.name}: ${JSON.stringify(a.ranges?.map((r) => r.events) ?? [])}`);
  const { finding } = await ingest({
    id: sha(`manual:${v.id}:${v.modified ?? ""}`), source: "manual", sourceClass: "on_demand",
    url: `https://osv.dev/vulnerability/${v.id}`, title: v.summary ?? v.id, author: "OSV",
    text: `${v.summary ?? ""}\n\n${v.details ?? ""}\n\nAffected: ${ranges.join("; ")}`,
    ids, packages: (v.affected ?? []).filter((a) => a.package).map((a) => ({ ecosystem: a.package!.ecosystem.toLowerCase(), name: a.package!.name })),
    published_at: v.published ?? null, discovered_at,
  });
  await processFinding(finding.id);
  const f = await store.getFinding(finding.id);
  const all = await store.listAssessments(200);
  return Response.json({ finding: f, assessments: all.filter((a) => a.finding_id === finding.id), note: "on-demand analysis (manual override); read-only; nothing executed" });
}
