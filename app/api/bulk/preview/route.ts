// POST {assessment_ids, mode?} — bulk-fix preview. Classifies each selected finding from real state; starts no work,
// calls no model, writes nothing. Every id is re-checked against the caller's visible repositories (tenant isolation):
// ids the caller cannot see are reported as unavailable, not silently dropped or included.
import { withAgentFor, fixesFor } from "@/lib/authz";
import { classify, type BulkItem } from "@/lib/bulk";
import { env, hasGitHubApp } from "@/lib/env";
import { installationPermissions } from "@/lib/github-app";
import { location, plainTitle } from "@/lib/labels";
import { destinationOf, modeOf } from "@/lib/remediation-mode";
import { canSee, currentUser, isSystemRepo } from "@/lib/session";
import { store } from "@/lib/store";
import { hostedUsedBy } from "@/lib/usage";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { assessment_ids?: unknown; mode?: unknown };
  const ids = [...new Set(Array.isArray(body.assessment_ids) ? body.assessment_ids.filter((x): x is string => typeof x === "string") : [])].slice(0, 50);
  if (!ids.length) return Response.json({ error: "Select at least one issue." }, { status: 400 });
  const mode = destinationOf(body.mode, modeOf(user.settings));
  const resolved = new Set(await store.resolvedSet(user.id));
  const perms = new Map<number, boolean | null>();
  const items: BulkItem[] = [];
  for (const id of ids) {
    const raw = await store.getAssessment(id);
    if (!raw || !(await canSee(user.id, raw.repo))) { items.push({ assessment_id: id, repo: "", title: "Unavailable", cls: "ineligible", reason: "Not found or not accessible." }); continue; }
    const [a] = await withAgentFor(user.id, [raw]);
    const [ur, demo, w, f, fixes] = await Promise.all([store.getUserRepo(user.id, a.repo), isSystemRepo(a.repo), store.getRepo(a.repo), store.getFinding(a.finding_id), fixesFor(user.id, a.id)]);
    const inst = w?.installation_id ?? ur?.installation_id ?? null;
    if (inst && !perms.has(inst)) perms.set(inst, env.FIX_ENABLED && hasGitHubApp() ? await installationPermissions(inst).then((p) => p.contents === "write" && p.pull_requests === "write").catch(() => false) : null);
    const c = classify(a, fixes, { fixEnabled: env.FIX_ENABLED, allowPr: !!ur?.allow_pr, isDemo: demo, hasInstallation: !!inst, writePermission: inst ? perms.get(inst) ?? null : null, mode }, resolved.has(a.id));
    items.push({ assessment_id: a.id, repo: a.repo, title: plainTitle(a, f, location(a), w?.tech_tags, w?.packages.map((p) => p.name)), ...c });
  }
  const verifications = items.filter((i) => i.cls === "needs_verification").length;
  const attempts = items.filter((i) => i.cls !== "ineligible").length;
  const hosted = await hostedUsedBy(user.id);
  return Response.json({
    items, mode,
    counts: { ready: items.filter((i) => i.cls === "ready").length, needs_verification: verifications, ineligible: items.length - attempts },
    repos: [...new Set(items.filter((i) => i.cls !== "ineligible").map((i) => i.repo.split("/").slice(0, 2).join("/")))],
    // Honest estimate: counts of work, plus the monthly hosted-analysis allowance; no invented prices or durations.
    estimate: { verification_checks: verifications, fix_attempts_max: attempts, hosted_used: hosted.used, hosted_cap: hosted.cap },
  });
}
