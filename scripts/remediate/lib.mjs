// Pure helpers for the remediation runner (scripts/remediate/run.mjs). No I/O, unit-tested in tests/remediate-lib.test.ts.

const MANIFEST_LOCK = { "package.json": ["package-lock.json", "npm-shrinkwrap.json"] };

/** Lockfiles the RUNNER (not Muse Code) must regenerate because Muse Code changed the dependency manifest next to them. */
export function lockfilesToRegenerate(changedPaths, existingPaths) {
  const out = [];
  for (const p of changedPaths) {
    const base = p.split("/").pop();
    const dir = p.slice(0, p.length - base.length);
    for (const lock of MANIFEST_LOCK[base] ?? []) if (existingPaths.includes(dir + lock)) out.push({ manifest: p, lockfile: dir + lock, dir: dir.replace(/\/$/, "") });
  }
  return out;
}

/** Did the dependency sections of a package.json change? (a version bump needs a new lockfile; a script edit does not) */
export function dependenciesChanged(beforeText, afterText) {
  const pick = (t) => { try { const j = JSON.parse(t); return JSON.stringify(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"].map((k) => j[k] ?? null)); } catch { return null; } };
  const a = pick(beforeText), b = pick(afterText);
  return a === null || b === null ? beforeText !== afterText : a !== b;
}

/** Which tests ran, from the output of node:test (spec/TAP), jest/vitest, or pytest. null = format not recognised. */
export function parseTestSummary(output) {
  const text = String(output ?? "");
  const num = (re) => { const m = re.exec(text); return m ? Number(m[1]) : null; };
  // node:test spec reporter: "ℹ tests 3", "ℹ pass 3", "ℹ fail 0"; TAP: "# tests 3", "# pass 3", "# fail 0"
  const nt = num(/(?:ℹ|#) tests (\d+)/), np = num(/(?:ℹ|#) pass (\d+)/), nf = num(/(?:ℹ|#) fail (\d+)/);
  if (nt !== null) {
    const names = [...text.matchAll(/^\s*(?:✔|✖|ok \d+ -|not ok \d+ -)\s+(.+?)(?:\s+\(\d[\d.]*m?s\))?\s*$/gm)].map((m) => m[1].trim()).filter((n) => !/^tests? /.test(n)).slice(0, 50);
    return { framework: "node:test", total: nt, passed: np ?? 0, failed: nf ?? 0, names };
  }
  // jest / vitest: "Tests:       1 failed, 4 passed, 5 total" or "Tests  5 passed (5)"
  const jm = /Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(?:(\d+) passed, )?(\d+) total/.exec(text);
  if (jm) return { framework: "jest", total: Number(jm[4]), passed: Number(jm[3] ?? 0), failed: Number(jm[1] ?? 0), names: [] };
  const vm = /Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/.exec(text);
  if (vm) return { framework: "vitest", total: Number(vm[3]), passed: Number(vm[2]), failed: Number(vm[1] ?? 0), names: [] };
  // pytest: "3 passed, 1 failed in 0.12s" / "5 passed in 0.03s" / "no tests ran"
  const pp = num(/(\d+) passed/), pf = num(/(\d+) failed/);
  if (/=+ .*(passed|failed|no tests ran).* =+|\d+ passed in [\d.]+s/.test(text)) return { framework: "pytest", total: (pp ?? 0) + (pf ?? 0), passed: pp ?? 0, failed: pf ?? 0, names: [] };
  return null;
}
