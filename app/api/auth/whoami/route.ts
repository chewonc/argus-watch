// Diagnostic for the current browser's sign-in state: session present? GitHub token obtainable? GitHub user readable?
// Returns nothing secret (no tokens, no cookies); safe to open in a browser and paste.
import { whoami } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await whoami(), { headers: { "cache-control": "no-store" } });
}
