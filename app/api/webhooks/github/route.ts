// S1: GitHub App webhook. Verify HMAC, store, enqueue, answer fast (GitHub requires 2xx within 10 s).
import { itemFromGHSA, verifyGitHubSignature } from "@/lib/sources/ghsa";
import { env } from "@/lib/env";
import { ingest } from "@/lib/pipeline";
import { store } from "@/lib/store";

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
  if (event !== "security_advisory") { await store.log({ kind: "webhook", source: "github", detail: `ignored event ${event}`, ref: delivery }); return Response.json({ ok: true, ignored: event }); }
  if (!(await store.markSeen("github-delivery", delivery))) return Response.json({ ok: true, duplicate: true });

  const payload = JSON.parse(raw);
  const item = itemFromGHSA(payload, discovered_at);
  await store.log({ kind: "webhook", source: "github", detail: `security_advisory.${payload.action} ${item.ids[0] ?? ""} ${item.title.slice(0, 60)}`, ref: delivery });
  const { finding, queued, created } = await ingest(item);
  return Response.json({ ok: true, finding: finding.id, queued, created, discovered_at });
}
