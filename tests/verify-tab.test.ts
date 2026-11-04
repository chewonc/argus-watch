// Verify tab: exact GitHub line links and evidence collapsed by default.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { codeUrl, permalink } from "../lib/remediation";
import { EvidenceList } from "../components/fix-modal";

const SHA = "e1764c0f9f38a1b2c3d4e5f60718293a4b5c6d7e";

test("line range: commit-pinned blob URL with GitHub's #Lfrom-Lto anchor", () => {
  assert.equal(codeUrl("chewonc/argus-watch", SHA, "feasibility/cases/c13_mcp_toxic_flow_affected/src/triage-agent.ts", 7, 37),
    `https://github.com/chewonc/argus-watch/blob/${SHA}/feasibility/cases/c13_mcp_toxic_flow_affected/src/triage-agent.ts#L7-L37`);
  assert.match(codeUrl("o/r", SHA, "a.ts", 5, 5)!, /#L5$/, "single line has no range");
  assert.match(codeUrl("o/r", SHA, "a.ts", 9, 3)!, /#L9$/, "inverted range falls back to the start line");
});

test("monorepo subfolder is not a repository: only owner/name form the repo", () => {
  assert.equal(codeUrl("o/r/packages/api", SHA, "packages/api/src/x.ts", 2), `https://github.com/o/r/blob/${SHA}/packages/api/src/x.ts#L2`);
});

test("special characters are encoded per path segment", () => {
  assert.equal(codeUrl("o/r", SHA, "src/my file#1?.ts", 3), `https://github.com/o/r/blob/${SHA}/src/my%20file%231%3F.ts#L3`);
});

test("refuses to guess: bad sha, repo, traversal or empty path -> null; prose fallback is the repository page", () => {
  assert.equal(codeUrl("o/r", "main", "a.ts", 1), null);
  assert.equal(codeUrl("o", SHA, "a.ts", 1), null);
  assert.equal(codeUrl("o/r", SHA, "src/../secret", 1), null);
  assert.equal(codeUrl("o/r", SHA, "", 1), null);
  assert.equal(codeUrl("o/r", SHA, "a.ts", 0), `https://github.com/o/r/blob/${SHA}/a.ts`);
  assert.equal(permalink("o/r/sub", "main", "a.ts", 1), "https://github.com/o/r");
});

test("evidence is a collapsed disclosure with its count, and keeps classification, citation and quote", () => {
  const html = renderToStaticMarkup(createElement(EvidenceList, { items: [
    { text: "Token verified without algorithm allowlist", state: "Observed", refs: [{ file: "deep/nested/src/auth.ts", line: 4, quote: "jwt.verify(t, key)", url: `https://github.com/o/r/blob/${SHA}/deep/nested/src/auth.ts#L4` }] },
    { text: "Key may be empty", state: "Inferred", computed: true, refs: [] },
  ] }));
  assert.match(html, /^<details class="disclose"><summary>Evidence \(2\)<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /Observed in your code/); assert.match(html, /Inferred.*\(computed\)/);
  assert.match(html, />auth\.ts:4 ↗</); assert.doesNotMatch(html, />deep\/nested/, "full path only in the title");
  assert.match(html, /target="_blank"/); assert.match(html, /jwt\.verify\(t, key\)/);
});
