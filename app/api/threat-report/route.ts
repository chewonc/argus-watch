// POST {url, description?, contact?} — "Report a threat" from the landing page. Untrusted input: validated, rate-limited,
// de-duplicated, stored privately with status "pending_review". The server never fetches the submitted URL (no SSRF),
// never publishes it and never marks it verified; the operator reviews reports (GET with the admin token) and, if
// relevant, ingests them through the existing admin replay/analyze path, which runs the normal credibility checks.
import { createHash, randomBytes } from "node:crypto";
import { isAdminAuth } from "@/lib/env";
import { currentUser } from "@/lib/session";
import { store } from "@/lib/store";
import { reportKey, validateReport } from "@/lib/threat-report";

const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateReport(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const user = await currentUser().catch(() => null);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const who = user?.id ?? `ip:${h(ip)}`;
  const hour = Math.floor(Date.now() / 3600e3);
  if ((await store.bump(`report:${who}:${hour}`)) > 5) return Response.json({ error: "Too many reports. Try again later." }, { status: 429 });
  if ((await store.bump(`report:all:${hour}`)) > 200) return Response.json({ error: "Reporting is busy right now. Try again later." }, { status: 429 });
  if (!(await store.claim(`report:url:${h(reportKey(v.value.url))}`))) return Response.json({ ok: true, duplicate: true, message: "Thanks. This link was already reported and is in our review queue." });
  await store.addThreatReport({ id: randomBytes(8).toString("hex"), ...v.value, submitted_at: new Date().toISOString(), status: "pending_review", user_id: user?.id ?? null, ip_hash: user ? null : h(ip) });
  return Response.json({ ok: true, message: "Thanks. We'll review it. Reports are checked before they become alerts." });
}

/** Operator review queue (ADMIN_TOKEN only). Reports are never exposed publicly. */
export async function GET(req: Request) {
  if (!isAdminAuth(req.headers.get("authorization"))) return new Response("unauthorized", { status: 401 });
  return Response.json({ reports: await store.listThreatReports(200) });
}
