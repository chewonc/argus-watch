// AI Agent tab: no Preview, Copy + "Set up MCP" (new tab to the real setup guide), prompt unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskAgent, agentPrompt } from "../components/ask-agent";

const ID = "f1:chewonc/argus-watch/feasibility/cases/c4:abc1234:v1";

test("prompt still names the alert and asks for read-only verification or an approval-gated fix", () => {
  const v = agentPrompt(ID, false); const f = agentPrompt(ID, true);
  assert.ok(v.includes(ID) && f.includes(ID));
  assert.match(v, /Don't change any code/); assert.match(v, /report your result back to Argus Watch/);
  assert.match(f, /propose a fix/); assert.match(f, /until I approve it/);
});

test("layout: Copy instructions and Set up MCP only; no Preview; setup opens Settings → Connect AI agent in a new tab", () => {
  const html = renderToStaticMarkup(createElement(AskAgent, { id: ID, connected: true, verified: true }));
  assert.doesNotMatch(html, /Preview/);
  assert.match(html, />Copy instructions</);
  assert.match(html, /<a href="\/settings#connect-agent" target="_blank" rel="noreferrer"[^>]*>Set up MCP/);
  assert.match(html, /via MCP/); assert.match(html, /No code changes without your approval/);
  assert.doesNotMatch(html, /aw_[A-Za-z0-9]/, "no token in the modal");
  assert.equal((html.match(/<button/g) ?? []).length, 1);
});

test("not connected: says to set up MCP first", () => {
  assert.match(renderToStaticMarkup(createElement(AskAgent, { id: ID, connected: false, verified: false })), /set up MCP once/);
});
