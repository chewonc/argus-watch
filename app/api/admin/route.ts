// Admin (ADMIN_TOKEN): manage watched repos, replay a stored real payload, trigger heartbeat.
// Replays are labeled; they re-run the SAME pipeline but never count as live deliveries.
import { env } from "@/lib/env";
import { ingest, processFinding } from "@/lib/pipeline";
import { refreshRepo } from "@/lib/repo";
import { WatchedRepo } from "@/lib/schema";
import { itemFromGHSA } from "@/lib/sources/ghsa";
import { store } from "@/lib/store";
import { enqueueProcess } from "@/lib/queue";
import { sha } from "@/lib/dedup";

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
      return Response.json({ ok: true, repo: store.repoKey(r), sha: r.sha, packages: r.packages.length, tech_tags: r.tech_tags });
    }
    case "unwatch": { await store.putRepo({ ...(await store.getRepo(String(body.repo)))!, packages: [], tech_tags: [] }); return Response.json({ ok: true }); }
    case "replay_ghsa": {
      // body.payload = a real security_advisory webhook payload previously received (or a GHSA fetched as such)
      const discovered_at = new Date().toISOString();
      const item = itemFromGHSA(body.payload as Parameters<typeof itemFromGHSA>[0], discovered_at);
      item.id = sha(`replay:${item.id}:${discovered_at}`);
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
      // Re-run any poll whose last run is older than its interval * 2 (backup for QStash).
      const limits: Record<string, number> = { kev: 30, rss: 10 };
      const ran: string[] = [];
      for (const [src, min] of Object.entries(limits)) {
        const st = await store.getPollState<{ last_run: string }>(src);
        if (!st || Date.now() - Date.parse(st.last_run) > min * 2 * 60e3) {
          await fetch(`${env.APP_URL}/api/poll/${src}`, { method: "POST", headers: { authorization: `Bearer ${env.ADMIN_TOKEN}` } });
          ran.push(src);
        }
      }
      await store.log({ kind: "heartbeat", source: "admin", detail: ran.length ? `re-ran stale polls: ${ran.join(", ")}` : "all polls fresh" });
      return Response.json({ ok: true, ran });
    }
    default: return Response.json({ error: "unknown op" }, { status: 400 });
  }
}
