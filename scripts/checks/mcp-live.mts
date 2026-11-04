// End-to-end check of the MCP endpoint over real HTTP, exactly as a coding agent connects: Streamable HTTP POSTs
// with a personal bearer token. Read-only by default (initialize, tools/list, list_findings, get_finding,
// get_file_context, plus the auth refusals). `--report` also calls report_result with a deliberately fabricated
// quote and expects it to be rejected, so nothing is ever stored.
// Run against a server:  ARGUS_MCP_URL=http://localhost:3000/api/mcp ARGUS_MCP_TOKEN=aw_... node --import tsx scripts/checks/mcp-live.mts [--report]
const url = process.env.ARGUS_MCP_URL ?? "http://localhost:3000/api/mcp";
const token = process.env.ARGUS_MCP_TOKEN ?? "";
if (!token) { console.error("set ARGUS_MCP_TOKEN (Settings → Connect AI agent)"); process.exit(2); }

let id = 0, failures = 0;
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };
async function rpc(method: string, params: unknown = {}, auth: string | null = token, extra: Record<string, string> = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const text = await res.text();
  let body: { result?: Record<string, unknown>; error?: { message: string } } | null = null; try { body = JSON.parse(text); } catch { /* non-JSON refusal */ }
  return { status: res.status, body };
}
const tool = async (name: string, args: Record<string, unknown>) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const content = (r.body?.result?.content as { text: string }[] | undefined)?.[0]?.text;
  let data = null; try { data = content ? JSON.parse(content) : null; } catch { data = { message: content }; } // refusals are plain text
  return { ...r, isError: !!r.body?.result?.isError, data };
};

const t0 = Date.now();
ok((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-live-check", version: "1" } }, null)).status === 401, "no token → 401");
ok((await rpc("initialize", {}, "aw_not_a_real_token")).status === 401, "bad token → 401");
ok((await rpc("initialize", {}, token, { origin: "https://evil.example" })).status === 403, "foreign browser Origin → 403");
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-live-check", version: "1" } });
ok(init.status === 200 && init.body?.result?.serverInfo, `initialize → ${JSON.stringify(init.body?.result?.serverInfo ?? init.body?.error)}`);
const list = await rpc("tools/list");
const names = ((list.body?.result?.tools as { name: string }[] | undefined) ?? []).map((t) => t.name);
ok(["list_findings", "get_finding", "get_file_context", "report_result"].every((n) => names.includes(n)), `tools/list → ${names.join(", ")}`);

const lf = await tool("list_findings", { status: "all" });
const findings = (lf.data?.findings ?? []) as { id: string; title: string; report_credibility: string | null }[];
ok(!lf.isError && Array.isArray(lf.data?.findings), `list_findings → ${findings.length} finding(s)`);
if (findings.length) {
  const f = findings[0];
  ok("report_credibility" in f, `list_findings carries report_credibility (${f.report_credibility})`);
  const gf = await tool("get_finding", { id: f.id });
  ok(!gf.isError && gf.data?.id === f.id, `get_finding ${f.id.slice(0, 40)}…`);
  ok(gf.data && "provenance" in gf.data && "threat_timeline" in gf.data && "user_impact_simulation" in gf.data, `get_finding has provenance (${gf.data?.provenance?.model}, spark=${gf.data?.provenance?.analysed_by_muse_spark}), timeline (${gf.data?.threat_timeline?.events?.length ?? "none"} events), simulation (${gf.data?.user_impact_simulation ? "cached" : "none"})`);
  ok(Object.keys(gf.data ?? {}).filter((k) => /summary|recommend|whats_wrong|fix/.test(k) && !k.startsWith("untrusted_") && k !== "next_steps").length === 0, "third-party text only in untrusted_* fields");
  const fc = await tool("get_file_context", { id: f.id, context_lines: 3 });
  ok(!fc.isError, `get_file_context → ${(fc.data?.files ?? []).length} file(s)`);
  const nf = await tool("get_finding", { id: "not-a-finding-id" });
  ok(nf.isError || nf.body?.error, "unknown finding id is refused");
  if (process.argv.includes("--report")) {
    const file = fc.data?.files?.[0]?.file;
    const rr = await tool("report_result", { id: f.id, status: "confirmed", summary: "mcp-live-check: fabricated evidence that must be rejected", evidence: [{ file: file ?? "README.md", line: 1, quote: "this exact text does not exist in the file 7f3a" }] });
    ok(rr.isError || rr.data?.accepted === false, `report_result with a fabricated quote is rejected (${JSON.stringify(rr.data ?? rr.body?.error).slice(0, 120)})`);
  }
} else console.log("SKIP finding-level checks: this token's user has no findings");
console.log(`${failures ? "FAILED" : "OK"}: ${failures} failure(s) in ${Date.now() - t0} ms against ${url}`);
process.exit(failures ? 1 : 0);
