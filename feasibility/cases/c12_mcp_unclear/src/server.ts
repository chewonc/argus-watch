import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "local-notes", version: "0.1.0" });
server.tool("read_note", { name: { type: "string" } }, async ({ name }) => ({
  content: [{ type: "text", text: "note " + name }],
}));

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Bind address and any authenticating reverse proxy are decided by the deployment environment.
app.listen(Number(process.env.PORT ?? 3001), process.env.HOST);
