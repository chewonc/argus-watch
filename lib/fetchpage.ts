// S4: permitted fetch of the single page a feed item links to. Respects robots.txt, one request per host
// per second (per process), no login-walled or non-HTML content, 1.5 MB cap. Nothing is executed.
import { USER_AGENT } from "./ua";
const lastHit = new Map<string, number>();
const robotsCache = new Map<string, string[]>(); // host -> disallowed prefixes for *
const UA = USER_AGENT;

/** True when robots.txt disallows this path for all crawlers (or for SaveBell). Unreachable robots.txt counts as allowed. */
export async function disallowed(url: URL): Promise<boolean> {
  let rules = robotsCache.get(url.host);
  if (!rules) {
    rules = [];
    try {
      const r = await fetch(`${url.origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        let applies = false;
        for (const raw of (await r.text()).split("\n")) {
          const line = raw.split("#")[0].trim();
          const m = line.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
          if (!m) continue;
          if (m[1].toLowerCase() === "user-agent") applies = m[2].trim() === "*" || /savebell|argus/i.test(m[2]);
          else if (applies && m[2].trim()) rules.push(m[2].trim());
        }
      }
    } catch { /* treat as allowed if robots.txt unreachable */ }
    robotsCache.set(url.host, rules);
  }
  return rules.some((p) => url.pathname.startsWith(p));
}

export async function fetchPageText(href: string): Promise<{ ok: boolean; text: string; reason?: string }> {
  let url: URL;
  try { url = new URL(href); } catch { return { ok: false, text: "", reason: "bad url" }; }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, text: "", reason: "non-http" };
  if (await disallowed(url)) return { ok: false, text: "", reason: "robots.txt disallows" };
  const wait = 1000 - (Date.now() - (lastHit.get(url.host) ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(url.host, Date.now());
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (r.status === 401 || r.status === 403) return { ok: false, text: "", reason: `access restricted (${r.status})` };
    if (!r.ok) return { ok: false, text: "", reason: `http ${r.status}` };
    const ct = r.headers.get("content-type") ?? "";
    if (!/html|xml|text/.test(ct)) return { ok: false, text: "", reason: `unsupported content-type ${ct}` };
    const html = (await r.text()).slice(0, 1_500_000);
    const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, " ");
    const text = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    return { ok: true, text: text.slice(0, 20000) };
  } catch (e) {
    return { ok: false, text: "", reason: String(e).slice(0, 120) };
  }
}
