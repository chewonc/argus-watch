// Translation must never alter technical identifiers (lib/i18n/translate.ts placeholders + lib/i18n/mask.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mask } from "../lib/i18n/mask";
import { fromPlaceholders, toPlaceholders } from "../lib/i18n/translate";
import { en } from "../lib/i18n/dictionary";
import { dict as ko } from "../lib/i18n/ko";

test("identifiers become numbered placeholders and come back verbatim", () => {
  const m = mask("Upgrade next to 14.2.25 in src/app/page.tsx:12 (CVE-2025-29927)", ["next"]);
  const p = toPlaceholders(m.html);
  assert.ok(!/14\.2\.25|CVE-2025|page\.tsx/.test(p), p);
  const back = fromPlaceholders(p.replace("Upgrade", "업그레이드"), m.tokens);
  assert.match(back!, /14\.2\.25/); assert.match(back!, /src\/app\/page\.tsx:12/); assert.match(back!, /CVE-2025-29927/);
});

test("a translation that drops, duplicates or invents a placeholder is rejected (English is kept)", () => {
  const tokens = ["a.ts", "1.2.3"];
  assert.equal(fromPlaceholders("x ⟦0⟧", tokens), null);
  assert.equal(fromPlaceholders("x ⟦0⟧ ⟦0⟧", tokens), null);
  assert.equal(fromPlaceholders("x ⟦0⟧ ⟦2⟧", tokens), null);
  assert.equal(fromPlaceholders("⟦1⟧ x ⟦0⟧", tokens), "1.2.3 x a.ts");
});

test("the Korean dictionary covers every key and keeps {placeholders}", () => {
  for (const k of Object.keys(en) as (keyof typeof en)[]) {
    assert.ok(ko[k], `missing ko.${k}`);
    for (const ph of en[k].match(/\{\w+\}/g) ?? []) assert.ok(ko[k]!.includes(ph), `ko.${k} lost ${ph}`);
  }
});
