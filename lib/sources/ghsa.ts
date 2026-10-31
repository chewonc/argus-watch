// S1: GitHub-reviewed global advisories (push via GitHub App webhook) + OSV enrichment (lookup, not a feed).
import { createHmac, timingSafeEqual } from "node:crypto";
import { extractIds, sha } from "../dedup";
import type { Item } from "../schema";

export function verifyGitHubSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

type GHSAPayload = {
  action: "published" | "updated" | "withdrawn";
  security_advisory: {
    ghsa_id: string; cve_id: string | null; summary: string; description: string; severity: string;
    published_at: string; updated_at: string; withdrawn_at: string | null;
    references?: { url: string }[];
    vulnerabilities?: { package: { ecosystem: string; name: string }; vulnerable_version_range: string; first_patched_version: { identifier: string } | string | null }[];
  };
};

export function itemFromGHSA(p: GHSAPayload, discovered_at: string): Item {
  const a = p.security_advisory;
  const ids = [...new Set([a.ghsa_id, a.cve_id, ...extractIds(a.description ?? "")].filter((x): x is string => !!x).map((x) => x.toUpperCase()))];
  const ranges = (a.vulnerabilities ?? []).map((v) => `${v.package.ecosystem}/${v.package.name}: ${v.vulnerable_version_range}${v.first_patched_version ? ` (patched ${typeof v.first_patched_version === "string" ? v.first_patched_version : v.first_patched_version.identifier})` : ""}`);
  return {
    id: sha(`ghsa:${a.ghsa_id}:${a.updated_at}`),
    source: "ghsa",
    sourceClass: "push",
    url: `https://github.com/advisories/${a.ghsa_id}`,
    title: a.summary,
    author: "GitHub Security Advisories",
    text: `${a.summary}\n\n${a.description}\n\nAffected: ${ranges.join("; ")}\nSeverity: ${a.severity}\nAction: ${p.action}`,
    ids,
    packages: (a.vulnerabilities ?? []).map((v) => ({ ecosystem: v.package.ecosystem.toLowerCase(), name: v.package.name })),
    published_at: a.published_at,
    discovered_at,
    raw: { action: p.action, updated_at: a.updated_at, vulnerabilities: a.vulnerabilities ?? [] },
  };
}

// ---- OSV lookup (enrichment, used for aliases + affected ranges) ----------
export type OSVVuln = {
  id: string; aliases?: string[]; summary?: string; details?: string; modified?: string; published?: string;
  affected?: { package?: { ecosystem: string; name: string }; ranges?: { type: string; events: Record<string, string>[] }[]; versions?: string[] }[];
  references?: { type: string; url: string }[];
};
export async function osvGet(id: string): Promise<OSVVuln | null> {
  const r = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { headers: { "User-Agent": "ArgusWatch/0.1" } });
  if (!r.ok) return null;
  return (await r.json()) as OSVVuln;
}

/** SEMVER range events -> list of "introduced..fixed" tuples for a given npm package */
export function osvRangesFor(v: OSVVuln, ecosystem: string, name: string): { introduced: string; fixed: string | null }[] {
  const out: { introduced: string; fixed: string | null }[] = [];
  for (const a of v.affected ?? []) {
    if (a.package?.ecosystem?.toLowerCase() !== ecosystem || a.package?.name !== name) continue;
    for (const r of a.ranges ?? []) {
      if (r.type !== "SEMVER" && r.type !== "ECOSYSTEM") continue;
      let cur: { introduced: string; fixed: string | null } | null = null;
      for (const e of r.events) {
        if (e.introduced !== undefined) { if (cur) out.push(cur); cur = { introduced: e.introduced, fixed: null }; }
        if (e.fixed !== undefined && cur) { cur.fixed = e.fixed; out.push(cur); cur = null; }
        if (e.last_affected !== undefined && cur) { cur.fixed = `<=${e.last_affected}`; out.push(cur); cur = null; }
      }
      if (cur) out.push(cur);
    }
  }
  return out;
}
