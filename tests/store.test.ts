// Store behaviour on the in-memory backend (no Redis env): idempotent assessment list, user-repo cleanup, notifications.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Assessment } from "../lib/schema";
import { SYSTEM_USER, store } from "../lib/store";

const a = (id: string): Assessment => ({ id, finding_id: "f", repo: "o/r", sha: "0123456789ab", tier: "official", dependency: null, locations: [], conditions: [], verdict: "Unclear", verdict_reason: "", verdict_qualifier: "", missing_evidence: [], unverified: [], recommendations: [], timestamps: { published_at: null, discovered_at: "2026-01-01T00:00:00Z", processed_at: "2026-01-01T00:00:01Z", notified_at: null }, model: "none", replayed: false });

test("putAssessment is idempotent in the list", async () => {
  await store.putAssessment(a("t:1")); await store.putAssessment(a("t:1")); await store.putAssessment({ ...a("t:1"), verdict: "Affected" });
  const ids = (await store.listAssessmentIds()).filter((x) => x === "t:1");
  assert.equal(ids.length, 1);
  assert.equal((await store.getAssessment("t:1"))!.verdict, "Affected");
});

test("removeUserRepo drops the watched repo once nobody watches it", async () => {
  await store.putRepo({ repo: "o/x", default_branch: "main", subdir: "", sha: null, packages: [], tech_tags: [], refreshed_at: null, installation_id: null, private: false });
  await store.addUserRepo({ user_id: "gh:1", repo_key: "o/x", installation_id: null, allow_pr: false, local_root: null, added_at: "now" });
  await store.addUserRepo({ user_id: "gh:2", repo_key: "o/x", installation_id: null, allow_pr: false, local_root: null, added_at: "now" });
  assert.deepEqual((await store.repoUsers("o/x")).sort(), ["gh:1", "gh:2"]);
  assert.equal((await store.removeUserRepo("gh:1", "o/x")).repo_removed, false);
  assert.equal((await store.removeUserRepo("gh:2", "o/x")).repo_removed, true);
  assert.equal(await store.getRepo("o/x"), null);
  assert.ok(!(await store.listRepos()).some((r) => r.repo === "o/x"));
});

test("notifications: unread count, mark read, dedup pointer", async () => {
  const n = { id: "n1", user_id: "gh:9", kind: "alert" as const, assessment_id: "t:1", finding_id: "f", repo: "o/r", title: "t", verdict: "Unclear" as const, severity: { level: "low" as const, cvss: null, source: "estimated" as const }, created_at: "a", updated_at: "a", read_at: null, published_at: null, notified_at: "a", pushed_at: null, received_at: null };
  await store.putNotification(n, true);
  await store.notifDedupSet("gh:9", "f", "o/r", "n1");
  assert.equal(await store.unreadCount("gh:9"), 1);
  assert.equal(await store.notifDedupGet("gh:9", "f", "o/r"), "n1");
  await store.markNotificationRead("gh:9", "n1");
  assert.equal(await store.unreadCount("gh:9"), 0);
  assert.ok((await store.readSet("gh:9")).includes("t:1"));
  assert.equal(SYSTEM_USER, "system");
});
