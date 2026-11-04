// Server-side i18n entry points: the viewer's locale (cookie), the translated UI dictionary, and a page-level helper
// that translates a bounded batch of dynamic strings (alert titles, summaries, conditions) in one call.
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { kv } from "../store";
import { en, type Dict } from "./dictionary";
import { dict as ko } from "./ko";

/** Reviewed static dictionaries: no translation call, no latency, no cost. Missing keys fall back to English. */
const STATIC: Record<string, Partial<Dict>> = { ko };
import { normalizeLocale, translateMany } from "./translate";

export const LOCALE_COOKIE = "aw_locale";
export async function getLocale(): Promise<string> { return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value); }

const DICT_VERSION = createHash("sha256").update(JSON.stringify(en)).digest("hex").slice(0, 10);
const dictMemo = new Map<string, Dict>();
export async function getDict(locale: string): Promise<Dict> {
  locale = normalizeLocale(locale);
  if (locale === "en") return en;
  if (STATIC[locale]) return { ...en, ...STATIC[locale] } as Dict;
  const m = dictMemo.get(locale); if (m) return m;
  const k = `tr:dict:${locale}:${DICT_VERSION}`;
  const c = await kv.get<Dict>(k);
  if (c) { dictMemo.set(locale, c); return c; }
  const keys = Object.keys(en) as (keyof typeof en)[];
  const vals = await translateMany(keys.map((x) => en[x]), locale);
  const d = Object.fromEntries(keys.map((x, i) => [x, vals[i]])) as Dict;
  if (vals.some((v, i) => v !== en[keys[i]])) { await kv.set(k, d); dictMemo.set(locale, d); }
  return d;
}

/** Translate dynamic strings for one page render: at most 80 strings, each truncated to 1,500 characters. */
export async function tr(locale: string, texts: (string | null | undefined)[], keep: string[] = []): Promise<string[]> {
  const src = texts.slice(0, 80).map((t) => (t ?? "").slice(0, 1500));
  const out = await translateMany(src, locale, keep);
  return texts.map((t, i) => (i < 80 ? out[i] : (t ?? "")));
}
