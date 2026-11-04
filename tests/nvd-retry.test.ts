// NVD transient errors (503 seen on the first production run) are retried before the poll fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nvdGet } from "../lib/sources/nvd";

const seq = (codes: number[]) => { let i = 0; const calls: number[] = []; const get = (async () => { const c = codes[Math.min(i++, codes.length - 1)]; calls.push(c); return new Response("{}", { status: c }); }) as unknown as typeof fetch; return { get, calls }; };

test("nvd: a 503 followed by 200 succeeds after a retry", async () => {
  const { get, calls } = seq([503, 200]);
  const r = await nvdGet("https://nvd.test", {}, [1, 1], get);
  assert.equal(r.status, 200); assert.deepEqual(calls, [503, 200]);
});

test("nvd: persistent 503 gives up after the configured retries; 404 is not retried", async () => {
  const a = seq([503]); assert.equal((await nvdGet("https://nvd.test", {}, [1, 1], a.get)).status, 503); assert.equal(a.calls.length, 3);
  const b = seq([404]); assert.equal((await nvdGet("https://nvd.test", {}, [1, 1], b.get)).status, 404); assert.equal(b.calls.length, 1);
});
