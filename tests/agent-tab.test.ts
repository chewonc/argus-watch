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

test("layout: agent use first, prompt visible by default and identical to what Copy copies, MCP optional, no Preview", () => {
  for (const verified of [true, false]) {
    const html = renderToStaticMarkup(createElement(AskAgent, { id: ID, connected: false, verified }));
    assert.match(html, /Use your own AI agent/); assert.match(html, /Claude Code, Codex, or Muse Code/);
    assert.doesNotMatch(html, /Preview/); assert.doesNotMatch(html, /<pre[^>]*shidden/);
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1].replace(/&#x27;/g, "'");
    assert.equal(pre, agentPrompt(ID, verified));
    assert.equal((html.match(/<button/g) ?? []).length, 1, "Copy is the only button, available without MCP");
    assert.match(html, /<a href="\/settings#connect-agent" target="_blank" rel="noreferrer">How to connect MCP/);
    assert.ok(html.indexOf("Copy instructions") < html.indexOf("connect your AI agent"), "MCP comes after the agent workflow");
  }
});
