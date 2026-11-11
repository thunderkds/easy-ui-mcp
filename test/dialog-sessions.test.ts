// T031 x T029 — a held native dialog belongs to ONE session, through a real MCP client.
// Spawns the real server, so port 8765 must be free: stop the Docker container (or any
// other server on 8765) before running this file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8765;
const BASE_URL = `http://localhost:${PORT}`;
const REPORTS_DIR = path.join(process.cwd(), "reports");

const CONFIRM_PAGE =
  "data:text/html," +
  encodeURIComponent(
    `<title>Confirm</title><p id="r">none</p><button id="del" onclick="document.getElementById('r').textContent = String(confirm('Delete?'))">Delete</button>`
  );

let server: ChildProcessWithoutNullStreams | undefined;
const writtenReports = new Set<string>();
const clients: Client[] = [];

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(`${BASE_URL}/health`)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("server did not become healthy in time");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function startServer(env: Record<string, string>): Promise<void> {
  // Spawn node directly (not via npx/tsx wrappers) so SIGTERM reaches the server itself.
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    stdio: "pipe",
    env: { ...process.env, ...env },
  });
  await waitForServer(15_000);
}

async function stopServer(): Promise<void> {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  const proc = server;
  server = undefined;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    proc.kill("SIGTERM");
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(killTimer);
  }
  for (const file of writtenReports) rmSync(file, { force: true });
  writtenReports.clear();
}

async function connect() {
  const client = new Client({ name: "dialog-sessions-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`)));
  clients.push(client);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return { isError: result.isError === true, text: result.content.map((c) => c.text).join(" | ") };
  };
  const start = async (target: string) => {
    const r = await call("ui_start_session", { target });
    const id = /Session ([0-9a-f-]{36}) started/.exec(r.text)?.[1];
    assert.ok(id, `no session id in: ${r.text}`);
    return id;
  };
  return { call, start };
}

function reportFor(id: string): { json: any } | undefined {
  const name = readdirSync(REPORTS_DIR).find((f) => f.endsWith(`-${id.slice(0, 8)}.json`));
  if (!name) return undefined;
  const file = path.join(REPORTS_DIR, name);
  writtenReports.add(file);
  writtenReports.add(file.replace(/\.json$/, ".html"));
  return { json: JSON.parse(readFileSync(file, "utf8")) };
}

describe("a held dialog is per session", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "600000", MAX_SESSIONS_PER_CONNECTION: "3" }));
  after(stopServer);

  test("a dialog held in A leaves B working, refuses calls to A, and ui_dialog answers A only", async () => {
    const conn = await connect();
    const a = await conn.start("dialog-A");
    const b = await conn.start("dialog-B");
    for (const id of [a, b]) {
      assert.equal((await conn.call("ui_navigate", { url: CONFIRM_PAGE, session_id: id })).isError, false);
    }

    // T040: a snapshot in A, so a ref can be tried against the held dialog below
    assert.match((await conn.call("ui_get_page_state", { session_id: a })).text, /^@e1 button "Delete"$/m);

    const opened = await conn.call("ui_click", { selector: "#del", session_id: a });
    assert.equal(opened.isError, false);
    assert.match(opened.text, /Browser is waiting on a confirm dialog: "Delete\?"/);

    // B is not blocked: it can read, and even raise and answer its own dialog.
    const bText = await conn.call("ui_get_text", { selector: "#r", session_id: b });
    assert.equal(bText.isError, false, bText.text);
    const bBlocked = await conn.call("ui_click", { selector: "#del", session_id: b });
    assert.match(bBlocked.text, /waiting on a confirm dialog/);
    assert.equal((await conn.call("ui_dialog", { action: "dismiss", session_id: b })).isError, false);

    // A is refused, with the session-specific reason (not a session failure).
    const refused = await conn.call("ui_get_page_state", { session_id: a });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /A confirm dialog is waiting: "Delete\?" — answer it with ui_dialog first/);
    // a ref action is refused the same way, before the ref is looked at (the blocked page is never queried)
    const refRefused = await conn.call("ui_click", { selector: "@e1", session_id: a });
    assert.equal(refRefused.isError, true);
    assert.match(refRefused.text, /A confirm dialog is waiting: "Delete\?" — answer it with ui_dialog first/);

    // ui_dialog answers the session it is called for: A's confirm becomes true.
    const answered = await conn.call("ui_dialog", { action: "accept", session_id: a });
    assert.equal(answered.isError, false, answered.text);
    assert.match(answered.text, /Accepted the confirm dialog "Delete\?"/);
    const aText = await conn.call("ui_get_text", { selector: "#r", session_id: a });
    assert.match(aText.text, /true/);
    const bAfter = await conn.call("ui_get_text", { selector: "#r", session_id: b });
    assert.match(bAfter.text, /false/, "B's own dialog was dismissed, A's was accepted");

    for (const id of [a, b]) assert.match((await conn.call("ui_end_session", { session_id: id })).text, /ended \(passed\)/);
  });

  test("with two sessions open ui_dialog needs a session_id, like every session tool", async () => {
    const conn = await connect();
    const a = await conn.start("dialog-C");
    const b = await conn.start("dialog-D");
    const r = await conn.call("ui_dialog", { action: "accept" });
    assert.equal(r.isError, true);
    assert.match(r.text, /session_id/);
    for (const id of [a, b]) await conn.call("ui_end_session", { session_id: id });
  });
});

describe("idle close releases a held dialog", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "1500", MAX_SESSIONS_PER_CONNECTION: "3" }));
  after(stopServer);

  test("a session idle-closed with a dialog waiting dismisses it (answered by session-end) in a timed_out report", async () => {
    const conn = await connect();
    const id = await conn.start("dialog-idle");
    await conn.call("ui_navigate", { url: CONFIRM_PAGE, session_id: id });
    const opened = await conn.call("ui_click", { selector: "#del", session_id: id });
    assert.match(opened.text, /waiting on a confirm dialog/);

    const deadline = Date.now() + 10_000;
    let report = reportFor(id);
    while (!report && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      report = reportFor(id);
    }
    assert.ok(report, "the idle timer wrote a report");
    assert.equal(report.json.status, "timed_out");
    const dialogs = report.json.actions.filter((x: { action: string }) => x.action === "dialog");
    assert.equal(dialogs.length, 1);
    assert.deepEqual(dialogs[0].args, { type: "confirm", message: "Delete?", answer: "dismiss", answeredBy: "session-end" });
  });
});
