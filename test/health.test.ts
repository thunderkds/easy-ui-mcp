// Needs port 8765 free: the server port is hard-coded, so stop the Docker container (or any
// other server on 8765) before running this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const PORT = 8765;
const BASE_URL = `http://localhost:${PORT}`;

let server: ChildProcessWithoutNullStreams;

function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error("server did not become healthy in time"));
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

test.before(async () => {
  // Spawn node directly (not via npx/tsx wrappers) so SIGTERM reaches the server itself.
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { stdio: "pipe" });
  await waitForServer(15_000);
});

test.after(async () => {
  // Wait for the server to actually exit so nothing outlives this file (port 8765, open pipes).
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  const killTimer = setTimeout(() => server.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(killTimer);
});

test("GET /health returns 200 with a readiness payload", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("MCP initialize handshake succeeds and advertises ui_navigate", async () => {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" },
      },
    }),
  });
  assert.equal(res.status, 200);
  const sessionId = res.headers.get("mcp-session-id");
  assert.ok(sessionId, "expected mcp-session-id header");

  // Complete the handshake before listing tools.
  await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId!,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const listRes = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId!,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const text = await listRes.text();
  assert.match(text, /ui_navigate/);
});
