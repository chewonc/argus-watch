// Test runner: never persist to .data/store.json, never use a configured Redis.
process.env.AW_NO_PERSIST = "1"; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
const { run } = await import("node:test");
const { spec } = await import("node:test/reporters");
const { globSync } = await import("node:fs");
const files = globSync("tests/**/*.test.ts");
run({ files, concurrency: 1 }).compose(spec).pipe(process.stdout);
