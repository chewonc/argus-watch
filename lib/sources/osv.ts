// OSV.dev (official aggregate of GitHub, PyPI, Go, RustSec ... advisories), polled hourly with the exact
// (ecosystem, package, version) tuples of every watched repository. This is the most repository-specific source:
// a hit means "a known vulnerability affects a version you actually have installed", and the item carries the
// package coordinates so matching is exact (no keyword matching involved).
import { sha } from "../dedup";
import type { Item, WatchedRepo } from "../schema";

const ECO: Record<string, string> = { npm: "npm", pypi: "PyPI", go: "Go", cargo: "crates.io", maven: "Maven", rubygems: "RubyGems" };
type OsvVuln = { id: string; summary?: string; details?: string; aliases?: string[]; modified: string; published?: string; withdrawn?: string;
  affected?: { package?: { ecosystem: string; name: string }; ranges?: { type: string; events: Record<string, string>[] }[] }[]; references?: { url: string }[];
  database_specific?: { severity?: string } };

export function queriesFor(repos: WatchedRepo[]): { key: string; ecosystem: string; name: string; version: string }[] {
  const out = new Map<string, { key: string; ecosystem: string; name: string; version: string }>();
  for (const r of repos) for (const p of r.packages) {
    const eco = ECO[p.ecosystem.toLowerCase()];
    if (!eco || !p.version || /declared range/.test(p.source_file)) continue; // only exact, lockfile-resolved versions
    const key = `${eco}:${p.name}@${p.version}`;
    if (!out.has(key)) out.set(key, { key, ecosystem: eco, name: p.name, version: p.version });
  }
  return [...out.values()].slice(0, 1000);
}

/** One querybatch call → vulnerability ids per (package, version). */
export async function queryBatch(qs: { ecosystem: string; name: string; version: string }[]): Promise<{ id: string; modified: string }[][]> {
  const out: { id: string; modified: string }[][] = [];
  for (let i = 0; i < qs.length; i += 500) {
    const chunk = qs.slice(i, i + 500);
    const r = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: chunk.map((q) => ({ package: { ecosystem: q.ecosystem, name: q.name }, version: q.version })) }), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`OSV querybatch ${r.status}`);
    const j = (await r.json()) as { results: { vulns?: { id: string; modified: string }[] }[] };
    out.push(...j.results.map((x) => x.vulns ?? []));
  }
  return out;
}

export async function getVuln(id: string): Promise<OsvVuln | null> {
  const r = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
  return r.ok ? ((await r.json()) as OsvVuln) : null;
}

export function itemFromOsv(v: OsvVuln, discovered_at: string): Item {
  const pkgs = (v.affected ?? []).filter((a) => a.package).map((a) => ({ ecosystem: a.package!.ecosystem === "PyPI" ? "pypi" : a.package!.ecosystem.toLowerCase() === "crates.io" ? "cargo" : a.package!.ecosystem.toLowerCase(), name: a.package!.name }));
  const ranges = (v.affected ?? []).flatMap((a) => (a.ranges ?? []).map((r) => `${a.package?.name}: ${r.events.map((e) => Object.entries(e).map(([k, x]) => `${k} ${x}`).join("")).join(", ")}`)).slice(0, 6);
  return {
    id: sha(`osv:${v.id}:${v.modified}`),
    source: "osv", sourceClass: "polled",
    url: `https://osv.dev/vulnerability/${v.id}`,
    title: `${v.id}: ${(v.summary ?? v.details ?? "").slice(0, 140)}`,
    author: "OSV.dev",
    text: `${v.summary ?? ""}\n${(v.details ?? "").slice(0, 6000)}\nAffected: ${ranges.join("; ")}${v.withdrawn ? `\nWITHDRAWN ${v.withdrawn}` : ""}`,
    ids: [v.id, ...(v.aliases ?? [])].map((x) => x.toUpperCase().startsWith("GHSA") ? "GHSA" + x.slice(4).toLowerCase() : x.toUpperCase()),
    packages: [...new Map(pkgs.map((p) => [`${p.ecosystem}:${p.name}`, p])).values()],
    published_at: v.published ?? v.modified,
    discovered_at,
    raw: { severity: v.database_specific?.severity ?? null, withdrawn: v.withdrawn ?? null },
  };
}
