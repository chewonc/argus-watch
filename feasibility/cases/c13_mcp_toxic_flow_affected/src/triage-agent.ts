// Issue triage agent: reads open issues on our public repo and drafts follow-ups.
// Uses the GitHub MCP server for every GitHub operation.
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PUBLIC_REPO = "acme/website";

// Personal access token with the classic `repo` scope: covers every public and private repository of the account.
const transport = new StdioClientTransport({
  command: "github-mcp-server",
  args: ["stdio"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GH_PAT ?? "" },
});
const mcp = new Client({ name: "triage-agent", version: "0.3.0" });
await mcp.connect(transport);

// Expose every tool the GitHub MCP server offers (read and write).
const { tools } = await mcp.listTools();
const openaiTools = tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

const llm = new OpenAI();
const messages: OpenAI.ChatCompletionMessageParam[] = [
  { role: "system", content: "You are a helpful maintainer assistant. Use the GitHub tools to complete the task." },
  { role: "user", content: `Review the open issues in ${PUBLIC_REPO} and address them.` },
];

for (let step = 0; step < 20; step++) {
  const res = await llm.chat.completions.create({ model: "gpt-4.1", messages, tools: openaiTools });
  const msg = res.choices[0].message;
  messages.push(msg);
  if (!msg.tool_calls?.length) break;
  for (const call of msg.tool_calls) {
    // Auto-approve: run whatever the model asks for, with the arguments it chose.
    const out = await mcp.callTool({ name: call.function.name, arguments: JSON.parse(call.function.arguments) });
    // Issue titles and bodies written by anyone on the internet go straight back into the model context.
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.content) });
  }
}
