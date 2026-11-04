// Remediation windows: timezone, DST and validation rules (lib/window-schedule.ts). Pure, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { activeOccurrence, fmtLocal, localToUtc, nextOccurrence, occurrenceOn, scheduleErrors, validZone, WindowSchedule } from "../lib/window-schedule";

const S = (x: Partial<WindowSchedule> = {}): WindowSchedule => WindowSchedule.parse({ id: "s1", user_id: "gh:1", kind: "recurring", tz: "Asia/Seoul", start: "23:00", end: "07:00", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", ...x });
const Z = (iso: string) => Date.parse(iso);

test("Seoul 23:00 to 07:00 crosses midnight and is 8 hours (no DST in Korea)", () => {
  const o = occurrenceOn(S(), "2026-11-05");
  assert.equal(new Date(o.start_ms).toISOString(), "2026-11-05T14:00:00.000Z");
  assert.equal(new Date(o.end_ms).toISOString(), "2026-11-05T22:00:00.000Z");
});

test("Los Angeles: the spring-forward night is 7 hours and the fall-back night is 9, local times unchanged", () => {
  const la = S({ tz: "America/Los_Angeles" });
  const spring = occurrenceOn(la, "2026-03-07"); // DST starts Sun 2026-03-08 02:00
  assert.equal(new Date(spring.start_ms).toISOString(), "2026-03-08T07:00:00.000Z"); // 23:00 PST
  assert.equal(new Date(spring.end_ms).toISOString(), "2026-03-08T14:00:00.000Z"); // 07:00 PDT
  assert.equal((spring.end_ms - spring.start_ms) / 36e5, 7);
  const fall = occurrenceOn(la, "2026-10-31"); // DST ends Sun 2026-11-01 02:00
  assert.equal(new Date(fall.start_ms).toISOString(), "2026-11-01T06:00:00.000Z"); // 23:00 PDT
  assert.equal(new Date(fall.end_ms).toISOString(), "2026-11-01T15:00:00.000Z"); // 07:00 PST
  assert.equal((fall.end_ms - fall.start_ms) / 36e5, 9);
  // The next night after the change starts at 23:00 PDT again.
  assert.equal(new Date(occurrenceOn(la, "2026-03-09").start_ms).toISOString(), "2026-03-10T06:00:00.000Z");
});

test("a local time inside the spring-forward gap moves forward; an ambiguous fall-back time takes the earlier instant", () => {
  assert.equal(new Date(localToUtc("America/Los_Angeles", 2026, 3, 8, 2, 30)).toISOString(), "2026-03-08T10:30:00.000Z"); // = 03:30 PDT
  assert.equal(new Date(localToUtc("America/Los_Angeles", 2026, 11, 1, 1, 30)).toISOString(), "2026-11-01T08:30:00.000Z"); // first 01:30 (PDT)
  assert.equal(new Date(localToUtc("Europe/London", 2026, 3, 29, 1, 30)).toISOString(), "2026-03-29T01:30:00.000Z"); // gap 01:00-02:00 -> 02:30 BST
});

test("the window in progress is found after local midnight, and not after it ends", () => {
  const s = S();
  const at = (iso: string) => activeOccurrence(s, Z(iso));
  assert.equal(at("2026-11-05T20:00:00Z")?.local_date, "2026-11-05"); // 05:00 KST on the 6th
  assert.equal(at("2026-11-05T13:59:00Z"), null); // 22:59 KST
  assert.equal(at("2026-11-05T22:00:00Z"), null); // 07:00 KST: ended
  assert.equal(activeOccurrence(S({ enabled: false }), Z("2026-11-05T20:00:00Z")), null);
});

test("selected days: Mondays only; one-time windows run once", () => {
  const mon = S({ days: [1] });
  assert.equal(nextOccurrence(mon, Z("2026-11-04T03:00:00Z"))?.local_date, "2026-11-09");
  const once = S({ kind: "once", date: "2026-11-05" });
  assert.equal(activeOccurrence(once, Z("2026-11-05T15:00:00Z"))?.local_date, "2026-11-05");
  assert.equal(activeOccurrence(once, Z("2026-11-06T15:00:00Z")), null);
  assert.equal(nextOccurrence(once, Z("2026-11-07T00:00:00Z")), null);
});

test("validation is done on the server: zones, durations, levels, repositories", () => {
  const now = Z("2026-11-04T00:00:00Z");
  assert.equal(validZone("Asia/Seoul"), true);
  assert.equal(validZone("Mars/Base"), false);
  assert.ok(scheduleErrors(S({ tz: "KST" }), now).some((e) => /timezone/.test(e)));
  assert.ok(scheduleErrors(S({ start: "07:00", end: "07:00" }), now).some((e) => /same time/.test(e)));
  assert.ok(scheduleErrors(S({ start: "06:00", end: "23:00" }), now).some((e) => /at most 16 hours/.test(e)));
  assert.deepEqual(scheduleErrors(S({ level: "draft_pr" }), now), [], "draft pull requests are accepted; consent is checked separately (tests/window-write.test.ts)");
  assert.ok(scheduleErrors(S({ kind: "once", date: "2026-11-01" }), now).some((e) => /already ended/.test(e)));
  assert.ok(scheduleErrors(S({ repos: ["o/other"] }), now, new Set(["o/r"])).some((e) => /do not monitor/.test(e)));
  assert.deepEqual(scheduleErrors(S({ repos: ["o/r"] }), now, new Set(["o/r"])), []);
  assert.throws(() => S({ max_jobs: 9 }), "concurrency is capped in the schema");
  assert.throws(() => S({ budget_usd: 500 }), "budget is capped in the schema");
});

test("displayed times always name the timezone", () => {
  const s = fmtLocal("Asia/Seoul", Z("2026-11-05T14:00:00Z"));
  assert.match(s, /23:00/); assert.match(s, /Asia\/Seoul/);
});
