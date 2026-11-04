// Validation for user-submitted threat reports (pure, unit-tested). Submissions are untrusted: they are stored for a
// human/admin review and are never fetched by the server, never published, never marked verified, and never fed into
// model or agent instructions automatically. Accepted reports enter the normal pipeline only through the existing admin
// ingestion (/api/admin replay or /api/analyze), where the credibility check and evidence rules apply as for any source.
export type ReportInput = { url?: unknown; description?: unknown; contact?: unknown; website?: unknown };
export type ValidReport = { url: string; description: string; contact: string | null };

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export function validateReport(input: ReportInput): { ok: true; value: ValidReport } | { ok: false; error: string } {
  if (typeof input.website === "string" && input.website.trim()) return { ok: false, error: "Submission rejected." }; // honeypot field
  const raw = typeof input.url === "string" ? input.url.trim() : "";
  if (!raw || raw.length > 2000) return { ok: false, error: "Paste a link to the advisory, paper or report." };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "That doesn't look like a valid link." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Only http and https links are accepted." };
  if (u.username || u.password) return { ok: false, error: "Links with embedded credentials are not accepted." };
  if (PRIVATE_HOST.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || !u.hostname.includes(".")) return { ok: false, error: "Use a public link (no internal or IP addresses)." };
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 1000) : "";
  const contact = typeof input.contact === "string" && input.contact.trim() ? input.contact.trim().slice(0, 200) : null;
  u.hash = "";
  return { ok: true, value: { url: u.toString(), description, contact } };
}

/** Normalized key for duplicate detection (host + path, without tracking parameters). */
export function reportKey(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|fbclid$|gclid$)/.test(k)) u.searchParams.delete(k);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
}
