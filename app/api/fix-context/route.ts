// GET ?assessment_id= — everything the Fix modal needs, without any model call or runner job (opening the modal is cheap).
// Read-only: the saved remediation preference, why automation can or cannot act (deployment configuration vs repository
// permission vs the finding itself), the newest fix record, and the evidence / missing evidence for the Verify tab.
import { automationBlocker, latestFix } from "@/lib/actions";
import { listAgentTokens } from "@/lib/agent-token";
import { env, hasGitHubApp, hasRunner } from "@/lib/env";
import { installationPermissions } from "@/lib/github-app";
import { isVerified, location } from "@/lib/labels";
import { AFTER_FIX, modeOf } from "@/lib/remediation-mode";
import { canSee, currentUser, isSystemRepo } from "@/lib/session";
import { store } from "@/lib/store";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("assessment_id") ?? "";
  const a = id ? await store.getAssessment(id) : null;
  if (!a || !(await canSee(user.id, a.repo))) return Response.json({ error: "not found" }, { status: 404 });
  const [ur, demo, fixes, w, tokens] = await Promise.all([store.getUserRepo(user.id, a.repo), isSystemRepo(a.repo), store.listFixes(a.id), store.getRepo(a.repo), listAgentTokens(user.id)]);
  const inst = w?.installation_id ?? ur?.installation_id ?? null;
  const writePermission = env.FIX_ENABLED && inst && hasGitHubApp() ? await installationPermissions(inst).then((p) => p.contents === "write" && p.pull_requests === "write").catch(() => false) : null;
  const mode = modeOf(user.settings);
  const verified = isVerified(a);
  const blocker = a.verdict === "Not Affected" ? "This finding does not affect your code; there is nothing to fix." : automationBlocker(a, { fixEnabled: env.FIX_ENABLED, allowPr: !!ur?.allow_pr, isDemo: demo, hasInstallation: !!inst, writePermission, mode });
  const runnerMissing = env.FIX_ENABLED && !hasRunner() ? "Deployment configuration: the Muse Code runner is not configured, so patches are previewed by Muse Spark and syntax-checked only." : null;
  const loc = location(a);
  return Response.json({
    assessment_id: a.id,
    repo: a.repo.split("/").slice(0, 2).join("/"),
    default_branch: w?.default_branch ?? "main",
    verified,
    verdict: a.verdict,
    location: loc ? `${loc.file}:${loc.from}${loc.to !== loc.from ? `–${loc.to}` : ""}` : null,
    evidence: a.conditions.filter((c) => c.role === "required").map((c) => ({ text: c.text, state: c.state, refs: c.evidence.filter((e) => e.file).slice(0, 2).map((e) => ({ file: e.file, line: e.line ?? null, quote: (e.quote ?? "").slice(0, 200) })) })),
    missing: a.missing_evidence.slice(0, 5),
    fix: latestFix(fixes),
    // Auto Fix is offered only for confirmed findings that automation can act on; Verify and AI Agent are always available.
    can_act: verified && !blocker,
    blocker: verified ? blocker : null,
    runner_enabled: hasRunner(),
    runner_note: runnerMissing,
    mode,
    after_fix: AFTER_FIX[mode],
    agent_connected: tokens.length > 0,
  });
}
