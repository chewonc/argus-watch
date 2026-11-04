// Cross-user isolation (docs/SECURITY_AUDIT_TENANT_ISOLATION.md V1–V7). Two synthetic users in the local store; no real
// accounts, no network. User A and user B both watch the shared org repository "acme/shared"; A alone watches
// "alice/private", B alone watches "bob/private". Every test asserts that B is denied A's private resources.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assessmentFor, fixesFor, logVisibleTo, ownFix, redactFinding, withAgentFor } from "../lib/authz";
import { assertUserCanWrite, revalidateAccess } from "../lib/access";
import { recipientsFor } from "../lib/notify";
import type { Assessment, Finding, Fix, User } from "../lib/schema";
import { SYSTEM_USER, store } from "../lib/store";

const A = "gh:9001", B = "gh:9002";
const now = "2026-11-04T00:00:00Z";
const user = (id: string, settings: Partial<User["settings"]> = {}): User => ({ id, login: id.replace("gh:", "u"), name: null, email: null, avatar: null, created_at: now, settings: { inapp: true, push: false, webhook_url: null, locale: "en", remediation_mode: "pr", hide_demo: false, demo_alerts: false, ...settings } });
const link = (uid: string, repo_key: string, installation_id: number | null = 1) => store.addUserRepo({ user_id: uid, repo_key, installation_id, allow_pr: false, local_root: null, added_at: now });
const asmt = (id: string, repo: string, extra: Partial<Assessment> = {}) => ({ id, finding_id: "f-iso", repo, sha: "abc1234", verdict: "Affected", locations: [], conditions: [], missing_evidence: [], recommendations: [], timestamps: { published_at: null, discovered_at: now, processed_at: now, notified_at: null }, ...extra } as unknown as Assessment);
const fix = (id: string, uid: string, aid: string) => ({ id, assessment_id: aid, user_id: uid, repo: "acme/shared", repo_key: "acme/shared", base_sha: "abc1234", status: "drafted", summary: "A's patch", caveats: [], files: [{ path: "a.ts", before_sha: "x", patch: "SECRET-PATCH", after: "x", hunks: [] }], rejected_hunks: [], syntax_check: [], events: [], created_at: now } as unknown as Fix);

test("setup: two users, one shared org repository, one private repository each", async () => {
  await store.putUser(user(A)); await store.putUser(user(B));
  await link(A, "acme/shared"); await link(B, "acme/shared"); await link(A, "alice/private"); await link(B, "bob/private");
  await store.putAssessment(asmt("as-shared", "acme/shared")); await store.putAssessment(asmt("as-alice", "alice/private"));
});

test("V3: B cannot list or fetch A's remediation jobs and patches, even on a shared repository or by guessing the id", async () => {
  await store.putFix(fix("fx-a-0001", A, "as-shared"), true);
  assert.deepEqual((await fixesFor(B, "as-shared")).map((f) => f.id), []);
  assert.deepEqual((await fixesFor(A, "as-shared")).map((f) => f.id), ["fx-a-0001"]);
  assert.equal(await ownFix(B, "fx-a-0001"), null, "manipulated fix id");
  assert.equal((await ownFix(A, "fx-a-0001"))?.files[0].patch, "SECRET-PATCH");
});

test("V4: an AI-agent report by A changes only A's view; B and the shared record are untouched", async () => {
  await store.putAgentReport(A, "as-shared", { status: "not_affected", summary: "A says fine", evidence: [{ file: "a.ts", line: 1, quote: "x" }], pr_url: null, client: "claude", at: now });
  const [forA] = await withAgentFor(A, [asmt("as-shared", "acme/shared")]);
  const [forB] = await withAgentFor(B, [asmt("as-shared", "acme/shared")]);
  assert.equal(forA.agent?.status, "not_affected"); assert.equal(forB.agent, undefined);
  assert.equal((await store.getAssessment("as-shared"))?.agent, undefined, "nothing written to the shared assessment");
  // legacy shared-record reports: shown only to a sole watcher, never on a shared repo or a demo repo
  const legacy = { status: "confirmed", summary: "legacy", evidence: [], pr_url: null, client: null, at: now } as NonNullable<Assessment["agent"]>;
  assert.equal((await withAgentFor(B, [asmt("as-shared", "acme/shared", { agent: legacy })]))[0].agent, undefined);
  assert.equal((await withAgentFor(A, [asmt("as-alice", "alice/private", { agent: legacy })]))[0].agent?.summary, "legacy");
  assert.equal((await assessmentFor(B, "as-shared"))?.agent, undefined);
  const mcp = readFileSync("lib/mcp.ts", "utf8");
  assert.doesNotMatch(mcp, /putAssessment/, "MCP never writes the shared assessment");
});

test("V2: findings never reveal other users' repository names", () => {
  const f = { relevant_repos: ["acme/shared", "alice/private", "bob/private"] } as Finding;
  assert.deepEqual(redactFinding(f, new Set(["acme/shared", "bob/private"])).relevant_repos, ["acme/shared", "bob/private"]);
});

test("V1/V7: audit-log entries about another user's repository or account are hidden; pipeline entries stay", () => {
  const known = new Set(["acme/shared", "alice/private", "bob/private"]);
  const forB = new Set(["acme/shared", "bob/private"]);
  assert.equal(logVisibleTo({ kind: "fix", detail: "draft PR #2 on alice/private (argus/fix-1)", ref: null }, forB, known), false);
  assert.equal(logVisibleTo({ kind: "auth", detail: "ualice paused monitoring of alice/private", ref: null }, forB, known), false);
  assert.equal(logVisibleTo({ kind: "auth", detail: "installation 5 connected by ualice", ref: null }, forB, known), false, "user actions without a repository are private");
  assert.equal(logVisibleTo({ kind: "webhook", detail: "push alice/private@abc: refreshed", ref: null }, forB, known), false);
  assert.equal(logVisibleTo({ kind: "fix", detail: "draft PR #3 on bob/private", ref: null }, forB, known), true);
  assert.equal(logVisibleTo({ kind: "poll", detail: "rss: 3 new items from https://example.org/a/b", ref: null }, forB, known), true);
  const status = readFileSync("app/api/status/route.ts", "utf8");
  assert.doesNotMatch(status, /\blog: log/, "the public status endpoint returns no raw log");
});

test("V5: demo repositories notify only users who opted in, and each user can hide them", async () => {
  const { env } = await import("../lib/env"); env.DEMO_SHARED_REPOS = true;
  await store.addUserRepo({ user_id: SYSTEM_USER, repo_key: "chewonc/argus-watch/feasibility/cases/demo", installation_id: null, allow_pr: false, local_root: null, added_at: now });
  await store.putUser(user(B, { demo_alerts: true }));
  const r = await recipientsFor("chewonc/argus-watch/feasibility/cases/demo");
  assert.ok(r.includes(B)); assert.ok(!r.includes(A), "A did not opt in");
  const { visibleRepoKeys } = await import("../lib/session");
  assert.ok((await visibleRepoKeys(A)).has("chewonc/argus-watch/feasibility/cases/demo"));
  await store.putUser(user(A, { hide_demo: true }));
  assert.ok(!(await visibleRepoKeys(A)).has("chewonc/argus-watch/feasibility/cases/demo"));
  assert.ok(!(await visibleRepoKeys(B)).has("alice/private"), "B never sees A's private repository");
  const actions = readFileSync("app/repos/actions.ts", "utf8");
  assert.doesNotMatch(actions.slice(actions.indexOf("export async function rescan")), /DEMO_SHARED_REPOS/, "rescanning demo repos is not open to every user");
});

test("V6: lost GitHub access hides the repository (no deletion) and is restored when access returns; writes need the user's own push permission", async () => {
  await store.setAccessChecked(A, "2000-01-01T00:00:00Z");
  const gh = (repos: string[], push = false) => ({ listUserInstallations: async () => [{ id: 1 }], listUserInstallationRepos: async () => repos.map((full_name) => ({ full_name })), userRepoPermission: async () => ({ pull: true, push }) });
  const r1 = await revalidateAccess(A, "tok", Date.now(), gh(["acme/shared"]));
  assert.deepEqual(r1.lost, ["alice/private"]);
  assert.equal((await store.getUserRepo(A, "alice/private"))?.access_lost, true, "link kept, marked");
  assert.ok(!(await store.activeRepoUsers("alice/private")).includes(A), "no notifications while access is lost");
  await store.setAccessChecked(A, "2000-01-01T00:00:00Z");
  const r2 = await revalidateAccess(A, "tok", Date.now(), gh(["acme/shared", "alice/private"]));
  assert.deepEqual(r2.restored, ["alice/private"]);
  assert.equal((await revalidateAccess(A, "tok", Date.now(), gh([]))).checked, false, "rate-limited to once per 15 minutes");
  await assert.rejects(assertUserCanWrite("tok", "acme/shared", gh(["acme/shared"], false)), /does not have write access/);
  await assert.rejects(assertUserCanWrite(null, "acme/shared", gh([], true)), /sign in/);
  await assertUserCanWrite("tok", "acme/shared", gh(["acme/shared"], true));
});

test("every user-facing read of fixes goes through fixesFor/ownFix (static guard)", () => {
  for (const f of ["app/alerts/page.tsx", "app/case/[...id]/page.tsx", "app/api/fix-context/route.ts", "app/api/fix/route.ts", "app/api/simulate/route.ts", "app/api/timeline/route.ts", "app/api/fix/[id]/route.ts", "lib/mcp.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /store\.listFixes\(/, `${f} reads fixes without the owner filter`);
  }
});
