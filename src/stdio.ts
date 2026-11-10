// MCP server entrypoint over stdio, for hosts that wrap a stdio server (e.g. Glama's `mcp-proxy`).
// The HTTP entry (src/server.ts) is unchanged; this one binds no port. Stdout carries JSON-RPC only,
// so every log line goes to stderr.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Set before server.js runs: a static import would hoist above this line.
process.env.EASY_UI_MCP_NO_HTTP = "1";
const { buildMcpServer, closeBrowser, settleClosing } = await import("./server.js");

const server = buildMcpServer();
await server.connect(new StdioServerTransport());

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server.close(); // runs the connection's onclose cleanup: ends its sessions, writes their reports
    await settleClosing();
    await closeBrowser();
  } catch (err) {
    console.error("easy-ui-mcp stdio: error while shutting down:", err);
  }
  process.exit(0); // the browser keeps the event loop alive
}

// The SDK's stdio transport does not notice stdin ending, so close on it here.
process.stdin.on("end", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.error("easy-ui-mcp stdio server ready");
