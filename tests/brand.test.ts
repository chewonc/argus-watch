// Guard: the old product name must not appear anywhere in shipped source (app/, components/, lib/, public/).
// Legacy functional identifiers (argus_* kinds, argus/fix- branches, "argus-watch" MCP name) do not match this pattern.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const OLD = /argus\s*watch|arguswatch/i;
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test("no old brand name in app/, components/, lib/ or public/", () => {
  const hits: string[] = [];
  for (const root of ["app", "components", "lib", "public"]) {
    for (const f of walk(root)) {
      if (!/\.(tsx?|mjs|js|css|json|html|svg|txt|webmanifest)$/.test(f)) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (OLD.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
    }
  }
  assert.deepEqual(hits, []);
});
