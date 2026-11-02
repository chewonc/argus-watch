// Argus Watch MCP endpoint (Streamable HTTP, stateless, JSON responses). Auth: a personal agent token from
// Settings → Connect AI agent, sent as `Authorization: Bearer aw_…`. Tools and boundaries: lib/mcp.ts.
import { resolveAgentToken } from "@/lib/agent-token";
import { handleRpc } from "@/lib/mcp";

export const dynamic = "force-dynamic";

const unauthorized = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or invalid Argus Watch agent token. Create one in Settings → Connect AI agent." } }),
  { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="argus-watch", error="invalid_token"' } });

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  // Browsers must not drive this endpoint cross-site (DNS-rebinding / CSRF); agents send no Origin.
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden origin", { status: 403 });
  const tok = await resolveAgentToken(req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null);
  if (!tok) return unauthorized();
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  const ctx = { uid: tok.user_id, client: req.headers.get("user-agent")?.slice(0, 60) ?? null };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(m, ctx)))).filter((x) => x !== null);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handleRpc(body as Parameters<typeof handleRpc>[0], ctx);
  return out === null ? new Response(null, { status: 202 }) : Response.json(out);
}

// No server-initiated stream and no sessions in this stateless server.
export async function GET() { return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }); }
export async function DELETE() { return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } }); }
