// Admin (ADMIN_TOKEN): manage watched repos, replay a stored real payload, trigger heartbeat.
// Replays are labeled; they re-run the SAME pipeline but never count as live deliveries.
import { env } from "@/lib/env";
import { ingest, processFinding } from "@/lib/pipeline";
import { refreshRepo } from "@/lib/repo";
import { WatchedRepo } from "@/lib/schema";
import { itemFromGHSA } from "@/lib/sources/ghsa";
import { SYSTEM_USER, store } from "@/lib/store";
import { enqueueProcess } from "@/lib/queue";
import { sha } from "@/lib/dedup";
import { TICK_MIN, tick } from "@/lib/poll";

export const maxDuration = 300;

const unauthorized = () => new Response("unauthorized", { status: 401 });

export async function POST(req: Request) {
  if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return unauthorized();
  const body = (await req.json()) as { op: string; [k: string]: unknown };
  const t0 = Date.now();
  switch (body.op) {
    case "watch": {
      const w = WatchedRepo.parse({ repo: body.repo, default_branch: body.default_branch ?? "main", subdir: body.subdir ?? "", label: body.label });
      let r;
      try { r = await refreshRepo(w); }
      catch (e) { return Response.json({ ok: false, error: `cannot read ${w.repo}@${w.default_branch}: ${String(e).slice(0, 200)}. Check the repo name, branch, and that GITHUB_TOKEN can read it.` }, { status: 400 }); }
      await store.putRepo(r);
      // Admin-registered repos belong to the reserved "system" user (demo mode shows them to every signed-in user).
      await store.addUserRepo({ user_id: SYSTEM_USER, repo_key: store.repoKey(r), installation_id: null, allow_pr: false, local_root: null, added_at: new Date().toISOString() });
      return Response.json({ ok: true, repo: store.repoKey(r), sha: r.sha, packages: r.packages.length, tech_tags: r.tech_tags });
    }
    case "migrate_system": {
      // One-time: link every existing watched repo to the system user so it stays visible after the identity layer.
      let n = 0;
      for (const w of await store.listRepos()) { const k = store.repoKey(w); if (!(await store.getUserRepo(SYSTEM_USER, k))) { await store.addUserRepo({ user_id: SYSTEM_USER, repo_key: k, installation_id: null, allow_pr: false, local_root: null, added_at: new Date().toISOString() }); n++; } }
      return Response.json({ ok: true, linked: n });
    }
    case "unwatch": {
      const k = String(body.repo);
      if (!(await store.getRepo(k))) return Response.json({ ok: false, error: `not watched: ${k}` }, { status: 404 });
      await store.removeRepo(k);
      return Response.json({ ok: true, removed: k });
    }
    case "cleanup": {
      // Dedupe the assessments list; optionally delete demo data for repos under a prefix (e.g. "chewonc/argus-watch/feasibility").
      const r = await store.cleanup(body.repo_prefix ? String(body.repo_prefix) : undefined);
      await store.log({ kind: "process", source: "admin", detail: `cleanup: list ${r.list_before}→${r.list_after}, deleted ${r.deleted_assessments} assessment(s), ${r.deleted_findings} finding(s)` });
      return Response.json({ ok: true, ...r });
    }
    case "replay_ghsa": {
      // body.payload = a real security_advisory webhook payload previously received (or a GHSA fetched as such).
      // The replayed item id is stable per payload so repeated replays do not accumulate duplicate items on the finding.
      const discovered_at = new Date().toISOString();
      const item = itemFromGHSA(body.payload as Parameters<typeof itemFromGHSA>[0], discovered_at);
      item.id = sha(`replay:${item.id}`);
      await store.log({ kind: "replay", source: "admin", detail: `replaying ${item.ids[0] ?? item.title.slice(0, 40)}`, ref: item.id });
      const { finding } = await ingest(item, { enqueue: false });
      await processFinding(finding.id, { replayed: true });
      return Response.json({ ok: true, finding: finding.id, replayed: true, ms: Date.now() - t0 });
    }
    case "requeue_stuck": {
      // Re-queue findings left in "new" or "error" (e.g. after a queue outage). Same pipeline; not replays.
      const stuck = (await store.listFindings()).filter((f) => f.status === "new" || f.status === "error");
      for (const f of stuck) await enqueueProcess(f.id);
      await store.log({ kind: "process", source: "admin", detail: `re-queued ${stuck.length} stuck finding(s)` });
      return Response.json({ ok: true, requeued: stuck.length });
    }
    case "reprocess": { await processFinding(String(body.id), { replayed: !!body.replayed }); return Response.json({ ok: true, ms: Date.now() - t0 }); }
    case "heartbeat": {
      // Backup for QStash: if the tick has not run for 2 tick intervals, run it now (each source still honours its own interval).
      const st = await store.getPollState<{ last_run: string }>("tick");
      const stale = !st || Date.now() - Date.parse(st.last_run) > TICK_MIN * 2 * 60e3;
      const r = stale ? await tick() : null;
      await store.log({ kind: "heartbeat", source: "admin", detail: stale ? `tick was stale; ran: ${r!.ran.join(", ") || "nothing due"}` : "tick fresh" });
      return Response.json({ ok: true, stale, ran: r?.ran ?? [] });
    }
    default: return Response.json({ error: "unknown op" }, { status: 400 });
  }
}
