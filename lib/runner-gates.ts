// Pure safety gates of the remediation runner, kept free of GitHub/model clients so they are unit-testable.
import { createHash } from "node:crypto";
import { env } from "./env";
import type { Fix } from "./schema";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();

export class RunnerError extends Error { constructor(msg: string, public status = 400) { super(msg); } }
/** Paths an automated fix may never change, whatever the model or runner reports. */
export const FORBIDDEN_PATH = /(^|\/)\.env|\.pem$|\.key$|(^|\/)\.github\/|(^|\/)\.muse\/|(^|\/)\.agents\/|(^|\/)\.mcp\.json$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum)$/;

export function event(fix: Fix, actor: string, action: string, detail: string, url: string | null = null): Fix {
  return { ...fix, events: [...(fix.events ?? []), { at: now(), actor, action, detail: detail.slice(0, 500), url }] };
}


/** Pure: which reported paths violate the authorization. */
export function outsideAllowlist(changed: string[], allowed: string[]): string[] {
  return changed.filter((p) => !allowed.includes(p) || FORBIDDEN_PATH.test(p) || p.includes(".."));
}

/** Pure: merge decision for push mode, from the repository's check-runs and the runner's own test result. */
export function mergeDecision(runs: { status: string; conclusion: string | null }[], testsPassed: boolean, attempt: number): "merge" | "wait" | "refuse_failed" | "refuse_unvalidated" | "timeout" {
  if (runs.some((r) => r.conclusion && !["success", "neutral", "skipped"].includes(r.conclusion))) return "refuse_failed";
  const pending = runs.some((r) => r.status !== "completed");
  if (pending || (!runs.length && !testsPassed && attempt < 3)) return attempt >= 15 ? "timeout" : "wait";
  if (!runs.length && !testsPassed) return "refuse_unvalidated";
  return "merge";
}

export function checkRunnerAuth(fix: Fix, req: Request, nonce: string | null): void {
  const secret = req.headers.get("x-argus-runner-secret") ?? "";
  if (!env.ARGUS_RUNNER_SECRET || secret.length !== env.ARGUS_RUNNER_SECRET.length || sha256(secret) !== sha256(env.ARGUS_RUNNER_SECRET)) throw new RunnerError("runner secret mismatch", 401);
  if (!nonce || !fix.nonce_hash || sha256(nonce) !== fix.nonce_hash) throw new RunnerError("nonce invalid or already used", 401);
}

