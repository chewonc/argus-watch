// Credibility rule (lib/verify.ts). Pure: inputs are facts plus model output already filtered to URLs the search saw.
import assert from "node:assert/strict";
import { test } from "node:test";
import { citedIds, credibilityLabel, type Artefact } from "../lib/verify";

const art = (id: string, status: Artefact["status"]): Artefact => ({ id, kind: id.startsWith("GHSA") ? "ghsa" : id.startsWith("arXiv") ? "arxiv" : "cve", status, registry: "test", url: `https://x/${id}`, title: null });
const base = { officialSource: false, artefacts: [] as Artefact[], publishers: ["blog.example"], primary: [] as string[], independent: [] as string[], contradictions: [] as { source_url: string; detail: string }[], suggested: null };

test("cited identifiers are extracted and normalised", () => {
  const ids = citedIds("See CVE-2025-29927 and ghsa-f82v-jwr5-mffw, paper arXiv:2402.06363v2 and https://arxiv.org/abs/2310.12815");
  assert.deepEqual(ids.cve, ["CVE-2025-29927"]);
  assert.deepEqual(ids.ghsa, ["GHSA-f82v-jwr5-mffw"]);
  assert.deepEqual(ids.arxiv, ["2402.06363", "2310.12815"]);
});

test("official sources are verified; the model cannot lower them", () => {
  assert.equal(credibilityLabel({ ...base, officialSource: true, suggested: "unverified" }).label, "verified");
});

test("a single blog with no primary source is unverified, never corroborated by repetition", () => {
  assert.equal(credibilityLabel(base).label, "unverified");
  // two articles on the same host are one publisher
  assert.equal(credibilityLabel({ ...base, publishers: ["blog.example"], independent: ["https://blog.example/b"] }).label, "unverified");
  assert.equal(credibilityLabel({ ...base, independent: ["https://other.example/a"] }).label, "corroborated");
});

test("an existing registry record corroborates; record + primary source verifies", () => {
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2025-29927", "exists")] }).label, "corroborated");
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2025-29927", "exists")], primary: ["https://github.com/vercel/next.js/security/advisories/GHSA-f82v-jwr5-mffw"] }).label, "verified");
});

test("rejected or withdrawn records dispute the report, even from an official source", () => {
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2099-0001", "rejected")] }).label, "disputed");
  assert.equal(credibilityLabel({ ...base, officialSource: true, artefacts: [art("GHSA-aaaa-bbbb-cccc", "withdrawn")] }).label, "disputed");
});

test("identifiers that exist nowhere make the report likely false", () => {
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2026-99999", "not_found")] }).label, "likely_false");
  // a registry error is not evidence of absence
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2026-99999", "error")] }).label, "unverified");
});

test("contradictions dispute; the model may lower but never raise", () => {
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2025-29927", "exists")], contradictions: [{ source_url: "https://nvd", detail: "versions differ" }] }).label, "disputed");
  assert.equal(credibilityLabel({ ...base, suggested: "verified" }).label, "unverified");
  assert.equal(credibilityLabel({ ...base, artefacts: [art("CVE-2025-29927", "exists")], suggested: "unverified" }).label, "unverified");
  // likely_false from the model alone, with no missing ids or contradictions, is not accepted
  assert.equal(credibilityLabel({ ...base, suggested: "likely_false" }).label, "unverified");
});
