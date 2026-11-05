// POST {name, url, description?}: "Suggest a source". Signed-in users only, rate-limited. The suggestion is checked
// automatically (lib/source-suggest.ts) and either added to monitoring, queued for review, or refused, with the reason.
// GET: the signed-in user's own suggestions; with the admin token, every suggestion (review queue).
import { isAdminAuth } from "@/lib/env";
import { evaluateSuggestion, listSuggestions, saveSuggestion } from "@/lib/source-suggest";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";

export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to suggest a source." }, { status: 401 });
  const hour = Math.floor(Date.now() / 3600e3);
  if ((await store.bump(`suggest:${user.id}:${hour}`)) > 5) return Response.json({ error: "Too many suggestions this hour. Try again later." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = await evaluateSuggestion(body, user.id);
  if ("error" in s) return Response.json({ error: s.error }, { status: 400 });
  if (s.status !== "duplicate") await saveSuggestion(s);
  await store.log({ kind: "auth", source: "sources", detail: `${user.login} suggested ${s.url}: ${s.status}${s.feed_id ? ` (${s.feed_id})` : ""}`.slice(0, 300) });
  return Response.json({ suggestion: s });
}

export async function GET(req: Request) {
  if (isAdminAuth(req.headers.get("authorization"))) return Response.json({ suggestions: await listSuggestions(undefined, 200) });
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ suggestions: await listSuggestions(user.id, 20) });
}
