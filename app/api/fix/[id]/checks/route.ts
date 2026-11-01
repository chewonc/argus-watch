// Read the repository's own CI check-runs on the fix branch (QStash-delayed after apply, or on demand).
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { refreshChecks } from "@/lib/fix-apply";
import { canSee, currentUser } from "@/lib/session";
import { store } from "@/lib/store";

async function handler(_req: Request, ctx?: { params?: Promise<{ id: string }> }) {
  const id = (await ctx?.params)?.id ?? "";
  const fix = await store.getFix(id);
  if (!fix || fix.status !== "pr_created") return Response.json({ error: "no pull request for this fix" }, { status: 404 });
  const w = await store.getRepo(fix.repo_key);
  const inst = w?.installation_id ?? (await store.getUserRepo(fix.user_id, fix.repo_key))?.installation_id;
  if (!inst) return Response.json({ error: "no installation" }, { status: 400 });
  return Response.json({ fix: await refreshChecks(fix, inst) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (user) { const fix = await store.getFix((await ctx.params).id); if (fix && (await canSee(user.id, fix.repo_key))) return handler(req, ctx); return Response.json({ error: "not found" }, { status: 404 }); }
  if (env.ADMIN_TOKEN && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`) return handler(req, ctx);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req, ctx);
  return new Response("unauthorized", { status: 401 });
}
