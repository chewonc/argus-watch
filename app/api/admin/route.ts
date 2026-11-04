// Admin (ADMIN_TOKEN): manage watched repos, replay a stored real payload, trigger heartbeat.
// Replays are labeled; they re-run the SAME pipeline but never count as live deliveries.
import { isAdminAuth } from "@/lib/env";
import { ingest, processFinding } from "@/lib/pipeline";
import { refreshRepo } from "@/lib/repo";
import { WatchedRepo } from "@/lib/schema";
import { itemFromGHSA } from "@/lib/sources/ghsa";
import { FEEDS, itemFromEntry } from "@/lib/sources/rss";
import { SYSTEM_USER, store } from "@/lib/store";
import { enqueueProcess } from "@/lib/queue";
import { sha } from "@/lib/dedup";
import { TICK_MIN, tick } from "@/lib/poll";

export const maxDuration = 300;

const unauthorized = () => new Response("unauthorized", { status: 401 });

export async function POST(req: Request) {
  if (!isAdminAuth(req.headers.get("authorization"))) return unauthorized();
  const body = (await req.json()) as { op: string; [k: string]: unknown };
  const t0 = Date.now();
  switch (body.op) {
    case "watch": {
      const w = WatchedRepo.parse({ repo: body.repo, default_branch: body.default_branch ?? "main", subdir: body.subdir ?? "", label: body.label });
      let r;
      try { r = await refreshRepo(w); }
      catch (e) { return Response.json({ ok: false, error: `cannot read ${w.repo}@${w.default_branch}: ${String(e).slice(0, 200)}. Check the repo name, branch, and that GITHUB_TOKEN can read it.` }, { status: 400 }); }
      await store.putRepo(r);
      // Admin-registered repos belong to the reserved "system" user (demo mode shows them to every signed-in user),
      // unless `user_id` names an existing user: then the repo is linked to that user (optionally with allow_pr), which is
      // how an operator can hand a repository to a specific account without the App flow. Writes still require an
      // App installation at apply time, so allow_pr here never bypasses that check.
      const uid = typeof body.user_id === "string" && body.user_id && body.user_id !== SYSTEM_USER ? body.user_id : SYSTEM_USER;
      if (uid !== SYSTEM_USER && !(await store.getUser(uid))) return Response.json({ ok: false, error: `unknown user ${uid}` }, { status: 404 });
      await store.addUserRepo({ user_id: uid, repo_key: store.repoKey(r), installation_id: null, allow_pr: uid !== SYSTEM_USER && body.allow_pr === true, local_root: null, added_at: new Date().toISOString() });
      return Response.json({ ok: true, repo: store.repoKey(r), sha: r.sha, packages: r.packages.length, tech_tags: r.tech_tags, user_id: uid });
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
    case "replay_feed_entry": {
      // body: { feed, url, title, published?, summary? }: one real article that a monitored feed published before polling
      // could see it. It enters as that feed's item (short summary, so the pipeline fetches the page itself) and runs the
      // SAME pipeline; it is labelled a replay and never counts as a live delivery.
      const feed = FEEDS.find((x) => x.id === body.feed);
      if (!feed || typeof body.url !== "string" || typeof body.title !== "string") return Response.json({ ok: false, error: "feed (known id), url and title are required" }, { status: 400 });
      const entry = { title: body.title, link: body.url, author: null, published: typeof body.published === "string" ? body.published : null, summary: typeof body.summary === "string" ? body.summary : "", guid: body.url };
      const item = itemFromEntry(feed, entry, new Date().toISOString());
      item.id = sha(`replay:${item.id}`);
      await store.log({ kind: "replay", source: "admin", detail: `replaying ${feed.id}: ${body.title.slice(0, 60)}`, ref: item.id });
      const { finding } = await ingest(item, { enqueue: false });
      await processFinding(finding.id, { replayed: true });
      const f = await store.getFinding(finding.id);
      return Response.json({ ok: true, finding: finding.id, status: f?.status, relevant_repos: f?.relevant_repos, replayed: true, ms: Date.now() - t0 });
    }
    case "requeue_stuck": {
      // Re-queue findings left in "new" or "error" (e.g. after a queue outage), and "analyzing" ones whose run died
      // (older than 15 minutes, or older records without a start time). Same pipeline; not replays.
      const cutoff = Date.now() - 15 * 60e3;
      const stuck = (await store.listFindings()).filter((f) => f.status === "new" || f.status === "error" || (f.status === "analyzing" && (!f.analyzing_at || Date.parse(f.analyzing_at) < cutoff)));
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
      // Remediation-window deadlines must not depend on QStash alone: the heartbeat always advances active windows.
      const { windowsTick } = await import("@/lib/window-tick"); const { windowDeps } = await import("@/lib/window-deps");
      const windows = await windowsTick(windowDeps(), 60e3).catch((e) => ({ opened: [], stepped: [], error: String(e).slice(0, 200) }));
      await store.log({ kind: "heartbeat", source: "admin", detail: stale ? `tick was stale; ran: ${r!.ran.join(", ") || "nothing due"}` : "tick fresh" });
      return Response.json({ ok: true, stale, ran: r?.ran ?? [], windows });
    }
    default: return Response.json({ error: "unknown op" }, { status: 400 });
  }
}
