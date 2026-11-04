// GitHub App webhook. Verify HMAC, store, enqueue, answer fast (GitHub requires 2xx within 10 s).
//   security_advisory       -> S1 ingestion (push class; "real-time" from GitHub's publication)
//   installation            -> suspend / unsuspend / delete bookkeeping
//   installation_repositories -> drop per-user links for removed repos
//   push (default branch)   -> refresh the watched repo's stack summary so later assessments use the new sha
import { itemFromGHSA, verifyGitHubSignature } from "@/lib/sources/ghsa";
import { env } from "@/lib/env";
import { ingest } from "@/lib/pipeline";
import { forgetInstallations, refreshRepo } from "@/lib/repo";
import { ALERT_HISTORY, store } from "@/lib/store";
import { refreshChecks } from "@/lib/fix-apply";

/** Open Argus pull requests on this repository, refreshed from GitHub. Returns how many are now merged. */
async function syncOpenFixes(fullName: string): Promise<number> {
  let merged = 0;
  const aids = [...new Set((await store.listAssessments(ALERT_HISTORY)).filter((a) => a.repo === fullName || a.repo.startsWith(`${fullName}/`)).map((a) => a.id))];
  for (const aid of aids) for (const fx of await store.listFixes(aid)) {
    if (!fx.pr_number || !["pr_created", "blocked_by_protection", "merging"].includes(fx.status)) continue;
    const inst = (await store.getRepo(fx.repo_key))?.installation_id ?? (await store.getUserRepo(fx.user_id, fx.repo_key))?.installation_id;
    if (!inst) continue;
    if ((await refreshChecks(fx, inst)).status === "merged") merged++;
  }
  return merged;
}

export const maxDuration = 30;

export async function POST(req: Request) {
  const raw = await req.text();
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = req.headers.get("x-github-delivery") ?? "";
  if (!verifyGitHubSignature(raw, req.headers.get("x-hub-signature-256"), env.GITHUB_WEBHOOK_SECRET)) {
    await store.log({ kind: "error", source: "webhook", detail: `rejected: bad signature (event=${event})`, ref: delivery });
    return new Response("invalid signature", { status: 401 });
  }
  const discovered_at = new Date().toISOString();
  if (event === "ping") { await store.log({ kind: "webhook", source: "github", detail: "ping received", ref: delivery }); return Response.json({ ok: true, pong: true }); }
  if (!(await store.markSeen("github-delivery", delivery))) return Response.json({ ok: true, duplicate: true });
  const payload = JSON.parse(raw) as Record<string, unknown>;

  if (event === "security_advisory") {
    const item = itemFromGHSA(payload as Parameters<typeof itemFromGHSA>[0], discovered_at);
    await store.log({ kind: "webhook", source: "github", detail: `security_advisory.${String(payload.action)} ${item.ids[0] ?? ""} ${item.title.slice(0, 60)}`, ref: delivery });
    // Push-source state: the first live delivery is the latency reference (anything published before it is backlog).
    const gs = (await store.getPollState<{ first_ok: string | null; deliveries: number; last_ok: string | null }>("ghsa")) ?? { first_ok: null, deliveries: 0, last_ok: null };
    await store.setPollState("ghsa", { ...gs, first_ok: gs.first_ok ?? discovered_at, deliveries: gs.deliveries + 1, last_ok: discovered_at });
    const { finding, queued, created } = await ingest(item);
    return Response.json({ ok: true, finding: finding.id, queued, created, discovered_at });
  }
  if (event === "installation") {
    const inst = payload.installation as { id: number; account: { login: string } };
    const action = String(payload.action);
    const ex = await store.getInstallation(inst.id);
    if (ex) await store.putInstallation({ ...ex, suspended: action === "suspend" || action === "deleted" ? true : action === "unsuspend" ? false : ex.suspended });
    forgetInstallations();
    await store.log({ kind: "webhook", source: "github", detail: `installation.${action} ${inst.account?.login ?? inst.id}`, ref: delivery });
    return Response.json({ ok: true });
  }
  if (event === "installation_repositories") {
    const removed = (payload.repositories_removed as { full_name: string }[] | undefined) ?? [];
    let dropped = 0;
    for (const r of removed) for (const w of await store.listRepos()) if (w.repo === r.full_name) {
      const k = store.repoKey(w);
      for (const uid of await store.repoUsers(k)) { await store.removeUserRepo(uid, k); dropped++; }
    }
    forgetInstallations();
    await store.log({ kind: "webhook", source: "github", detail: `installation_repositories.${String(payload.action)}: removed ${removed.length} repo(s), dropped ${dropped} link(s)`, ref: delivery });
    return Response.json({ ok: true, dropped });
  }
  if (event === "push") {
    const ref = String(payload.ref ?? ""), full = (payload.repository as { full_name: string; default_branch: string } | undefined);
    if (full && ref === `refs/heads/${full.default_branch}`) {
      let refreshed = 0;
      for (const w of await store.listRepos()) if (w.repo === full.full_name) { try { const r = await refreshRepo(w); if (r !== w) { await store.putRepo(r); refreshed++; } } catch (e) { await store.log({ kind: "error", source: "webhook", detail: `push refresh failed for ${w.repo}: ${String(e).slice(0, 120)}`, ref: delivery }); } }
      await store.log({ kind: "webhook", source: "github", detail: `push ${full.full_name}@${String(payload.after ?? "").slice(0, 7)}: refreshed ${refreshed} watched entr${refreshed === 1 ? "y" : "ies"}`, ref: delivery });
      // A push to the default branch may be the merge of an Argus pull request: re-read open Argus PRs (read-only).
      const merged = await syncOpenFixes(full.full_name).catch((e) => { void store.log({ kind: "error", source: "webhook", detail: `PR sync failed for ${full.full_name}: ${String(e).slice(0, 120)}`, ref: delivery }); return 0; });
      if (merged) await store.log({ kind: "webhook", source: "github", detail: `${merged} Argus pull request(s) on ${full.full_name} recorded as merged`, ref: delivery });
    }
    return Response.json({ ok: true });
  }
  await store.log({ kind: "webhook", source: "github", detail: `ignored event ${event}`, ref: delivery });
  return Response.json({ ok: true, ignored: event });
}
