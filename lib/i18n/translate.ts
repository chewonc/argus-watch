// Google Cloud Translation (v2 REST, server-side API key). Every string is cached in the store by (locale, sha8 of
// text), so a string costs one API call per language, ever. Failures fall back to English, never to an error page.
// Pricing (verified Nov 2026): 500,000 characters/month free, then $20 per million characters.
import { createHash } from "node:crypto";
import { env, hasTranslate } from "../env";
import { kv, store } from "../store";
import { mask, unmask } from "./mask";

const sha8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 10);
const key = (locale: string, text: string) => `tr:${locale}:${sha8(text)}`;
const memo = new Map<string, string>();
let failedAt = 0;

export const normalizeLocale = (l: string | null | undefined) => (l ?? "en").trim().toLowerCase().replace("_", "-").slice(0, 12) || "en";
export const isRtl = (l: string) => /^(ar|he|fa|ur|ps|sd|ug|yi)(-|$)/.test(l);

export async function translateMany(texts: string[], locale: string, keep: string[] = []): Promise<string[]> {
  locale = normalizeLocale(locale);
  if (locale === "en" || !texts.length) return texts;
  const out = [...texts];
  const todo: number[] = [];
  const keys = texts.map((t) => key(locale, t));
  const cached = await kv.mget<string>(keys.filter((k, i) => { const m = memo.get(k); if (m != null) { out[i] = m; return false; } return !!texts[i]; }));
  let ci = 0;
  for (let i = 0; i < texts.length; i++) { if (memo.has(keys[i]) || !texts[i]) continue; const c = cached[ci++]; if (c != null) { out[i] = c; memo.set(keys[i], c); } else todo.push(i); }
  if (!todo.length || !hasTranslate() || Date.now() - failedAt < 60e3) return out;
  const masked = todo.map((i) => mask(texts[i], keep));
  // Batches of ≤100 strings / ≤25k characters (API limits are higher; this keeps each call fast on serverless)
  const batches: number[][] = []; let cur: number[] = [], size = 0;
  for (let j = 0; j < todo.length; j++) { const len = masked[j].html.length; if (cur.length >= 100 || size + len > 25000) { batches.push(cur); cur = []; size = 0; } cur.push(j); size += len; }
  if (cur.length) batches.push(cur);
  const toSet: Record<string, string> = {};
  for (const b of batches) {
    try {
      const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: b.map((j) => masked[j].html), target: locale, source: "en", format: "html" }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`translate ${r.status}`);
      const j = (await r.json()) as { data: { translations: { translatedText: string }[] } };
      b.forEach((bi, n) => { const i = todo[bi]; const t = unmask(j.data.translations[n]?.translatedText ?? "", masked[bi].tokens) || texts[i]; out[i] = t; memo.set(keys[i], t); toSet[keys[i]] = t; });
    } catch (e) { failedAt = Date.now(); await store.log({ kind: "error", source: "translate", detail: `${locale}: ${String(e).slice(0, 120)}; falling back to English for 60 s` }); break; }
  }
  if (Object.keys(toSet).length) await kv.mset(toSet);
  return out;
}

export type Lang = { code: string; name: string };
/** Supported target languages, named in the viewer's own language; cached 24 h per display locale. */
export async function languages(display = "en"): Promise<Lang[]> {
  if (!hasTranslate()) return [{ code: "en", name: "English" }];
  const k = `tr:langs:${normalizeLocale(display)}`;
  const c = await kv.get<{ v: Lang[]; at: number }>(k);
  if (c && Date.now() - c.at < 86400e3) return c.v;
  try {
    const r = await fetch(`https://translation.googleapis.com/language/translate/v2/languages?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}&target=${encodeURIComponent(normalizeLocale(display))}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`languages ${r.status}`);
    const j = (await r.json()) as { data: { languages: { language: string; name?: string }[] } };
    const v = j.data.languages.map((l) => ({ code: l.language, name: l.name ?? l.language })).sort((a, b) => a.name.localeCompare(b.name));
    await kv.set(k, { v, at: Date.now() });
    return v;
  } catch { return c?.v ?? [{ code: "en", name: "English" }]; }
}
