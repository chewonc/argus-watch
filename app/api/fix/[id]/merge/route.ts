// Push mode: QStash-delayed merge attempts (or the fix owner on demand). Merges only when the repository's own
// check-runs pass (or the runner executed tests and the repo has no checks); refuses otherwise. Never bypasses protection.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { hasQStash } from "@/lib/env";
import { tryMerge } from "@/lib/runner";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export const maxDuration = 60;

async function handler(req: Request, ctx?: { params?: Promise<{ id: string }> }) {
  const id = (await ctx?.params)?.id ?? "";
  const fix = await store.getFix(id);
  if (!fix) return Response.json({ error: "not found" }, { status: 404 });
  const w = await store.getRepo(fix.repo_key);
  const inst = w?.installation_id ?? (await store.getUserRepo(fix.user_id, fix.repo_key))?.installation_id;
  if (!inst) return Response.json({ error: "no installation" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { attempt?: number };
  const out = await tryMerge(fix, inst, Math.max(0, Math.min(20, Number(body.attempt ?? fix.merge_attempts + 1))));
  return Response.json({ fix: out });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (user) { const fix = await store.getFix((await ctx.params).id); if (fix?.user_id === user.id) return handler(req, ctx); return Response.json({ error: "not found" }, { status: 404 }); }
  if (hasQStash()) return verifySignatureAppRouter(handler)(req, ctx);
  return new Response("unauthorized", { status: 401 });
}
