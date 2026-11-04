// Worker: one finding per invocation. Called by QStash (signature-verified) or admin token.
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { env, hasQStash } from "@/lib/env";
import { processFinding } from "@/lib/pipeline";

export const maxDuration = 300;

async function handler(req: Request, ctx?: { params?: Promise<{ id: string }> }) {
  const { id } = (await ctx?.params) ?? { id: decodeURIComponent(new URL(req.url).pathname.split("/").pop()!) };
  let replayed = false; let onlyRepo: string | undefined;
  try { const b = (await req.json()) as { replayed?: boolean; only_repo?: string }; replayed = !!b.replayed; onlyRepo = typeof b.only_repo === "string" ? b.only_repo : undefined; } catch { /* no body */ }
  const t0 = Date.now();
  await processFinding(decodeURIComponent(id), { replayed, onlyRepo });
  return Response.json({ ok: true, id, ms: Date.now() - t0 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = req.headers.get("authorization");
  if (env.ADMIN_TOKEN && auth === `Bearer ${env.ADMIN_TOKEN}`) return handler(req, ctx);
  if (hasQStash()) return verifySignatureAppRouter(handler)(req, ctx);
  if (process.env.NODE_ENV !== "production") return handler(req, ctx);
  return new Response("unauthorized", { status: 401 });
}
