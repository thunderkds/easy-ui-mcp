import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  server = spawn("npx", ["tsx", "src/server.ts"], { stdio: "pipe" });
  await waitForServer(15_000);
});

test.after(() => {
  server.kill("SIGTERM");
});

test("GET /health still returns 200 after /api/run-test is added (no regression)", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("POST /api/run-test with a valid body runs a smoke check and returns a real report", async () => {
  const res = await fetch(`${BASE_URL}/api/run-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      platform: "web",
      flow_description: "smoke check example.com",
      app_url_or_package: "https://example.com",
      timeout: 20_000,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "passed");
  assert.ok(body.report_url, "expected a report_url");
  assert.ok(existsSync(body.report_url), "report_url should point at a real file on disk");
  assert.ok(Array.isArray(body.screenshots) && body.screenshots.length > 0);
  assert.ok(Array.isArray(body.logs) && body.logs.length > 0);
});

test("POST /api/run-test missing app_url_or_package returns a clear 4xx error", async () => {
  const res = await fetch(`${BASE_URL}/api/run-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flow_description: "no target given" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /app_url_or_package/);
});

test("POST /api/run-test with an unreachable URL returns a failed status, not a crash", async () => {
  const res = await fetch(`${BASE_URL}/api/run-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_url_or_package: "http://this-host-does-not-exist.invalid",
      timeout: 20_000,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "failed");
  assert.ok(existsSync(body.report_url));
});
