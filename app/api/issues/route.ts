// POST {description, steps?, page_url, screenshot?}: a signed-in user's report about a problem with Argus Watch itself.
// Stored privately; GET with the admin token lists them (screenshots included as data URLs). Rate-limited.
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { kv, store } from "@/lib/store";

const MAX_SHOT = 700_000; // data-URL characters (~500 KB JPEG after the browser downscales it)

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to report an issue." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.website === "string" && b.website.trim()) return Response.json({ error: "Submission rejected." }, { status: 400 }); // honeypot
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 3000) : "";
  if (description.length < 5) return Response.json({ error: "Describe the problem in a few words." }, { status: 400 });
  const steps = typeof b.steps === "string" ? b.steps.trim().slice(0, 3000) : "";
  let page_url: string | null = null;
  try { const u = new URL(String(b.page_url ?? "")); if (u.origin === new URL(req.url).origin || u.origin === env.APP_URL) page_url = u.toString().slice(0, 1000); } catch { /* not a page of this site */ }
  const shot = typeof b.screenshot === "string" && b.screenshot ? b.screenshot : null;
  if (shot && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(shot) || shot.length > MAX_SHOT)) return Response.json({ error: "The screenshot couldn't be attached (image too large or unsupported)." }, { status: 400 });
  if ((await store.bump(`issue:${user.id}:${Math.floor(Date.now() / 3600e3)}`)) > 10) return Response.json({ error: "Too many reports this hour. Try again later." }, { status: 429 });
  const id = `IR-${randomBytes(4).toString("hex").toUpperCase()}`;
  await kv.lpush("issue_reports", { id, user_id: user.id, login: user.login, description, steps, page_url, screenshot: shot, user_agent: req.headers.get("user-agent")?.slice(0, 200) ?? null, submitted_at: new Date().toISOString(), status: "new" });
  await store.log({ kind: "auth", source: "issues", detail: `${user.login} reported an issue ${id}${page_url ? ` on ${new URL(page_url).pathname}` : ""}` });
  return Response.json({ ok: true, id });
}

/** Admin review queue (admin token only). */
export async function GET(req: Request) {
  if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return new Response("unauthorized", { status: 401 });
  return Response.json({ issues: await kv.lrange("issue_reports", 0, 199) });
}
