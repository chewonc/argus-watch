// Guard: no em dashes in SaveBell's own user-facing copy (UI strings, dictionaries, labels). Model or third-party text
// shown in the UI is normalized at display time by tidy(); stored evidence is never rewritten.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error plain .mjs helper without types
import { findEmDashes, stripComments } from "../scripts/checks/no-em-dash.mjs";
import { tidy } from "../lib/labels";

test("no em dashes in user-facing source copy", () => {
  assert.deepEqual(findEmDashes(), []);
});

test("the scanner ignores comments but catches strings, JSX text and \u2014 escapes", () => {
  const D = "—";
  assert.doesNotMatch(stripComments(`// a ${D} b\nconst x = 1; /* ${D} */`), new RegExp(D));
  assert.match(stripComments(`const s = "a ${D} b"; // ok`), new RegExp(D));
  assert.match(stripComments("const s = `x \u2014 y`;"), /\u2014/);
});

test("model text is tidied for display without em dashes", () => {
  assert.equal(tidy(`Auth bypass — middleware only`), "Auth bypass, middleware only");
  assert.equal(tidy(`Done —.`), "Done.");
});
