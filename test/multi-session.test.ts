// T029 — several concurrent sessions on one MCP connection, plus idle auto-close.
// The MCP-client tests spawn the real server, so port 8765 must be free: stop the Docker
// container (or any other server on 8765) before running this file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConnectionSessions, MAX_REMEMBERED_IDLE_CLOSES } from "../src/tools/connection-sessions.js";

// ---------------------------------------------------------------------------
// ConnectionSessions: the per-connection ownership rules, without a browser
// ---------------------------------------------------------------------------

describe("ConnectionSessions", () => {
  test("no id and no open session: the legacy shared page (no session, no error)", () => {
    const owned = new ConnectionSessions(3);
    assert.deepEqual(owned.resolve(undefined), {});
  });

  test("no id and exactly one open session: that session, as today (AC5)", () => {
    const owned = new ConnectionSessions(3);
    owned.add("a");
    assert.deepEqual(owned.resolve(undefined), { sessionId: "a" });
  });

  test("no id and several open sessions: an error that lists every open id (AC6, D1/D3)", () => {
    const owned = new ConnectionSessions(3);
    owned.add("a");
    owned.add("b");
    const r = owned.resolve(undefined);
    assert.equal(r.sessionId, undefined);
    assert.match(r.error!, /a/);
    assert.match(r.error!, /b/);
    assert.match(r.error!, /session_id/);
  });

  test("an owned id resolves to itself even when several are open", () => {
    const owned = new ConnectionSessions(3);
    owned.add("a");
    owned.add("b");
    assert.deepEqual(owned.resolve("b"), { sessionId: "b" });
  });

  test("an id that is not owned is Unknown session, never the legacy page, even with none open (AC7)", () => {
    const owned = new ConnectionSessions(3);
    assert.equal(owned.resolve("x").error, "Unknown session x");
    owned.add("a");
    assert.equal(owned.resolve("x").error, "Unknown session x");
  });

  test("an ended id is Unknown session again", () => {
    const owned = new ConnectionSessions(3);
    owned.add("a");
    owned.remove("a");
    assert.equal(owned.resolve("a").error, "Unknown session a");
    assert.deepEqual(owned.resolve(undefined), {});
  });

  test("an id closed after idle gets the D5 message, and is no longer open (AC14)", () => {
    const owned = new ConnectionSessions(3);
    owned.add("a");
    owned.markIdleClosed("a", "10 min");
    assert.equal(owned.resolve("a").error, "Session a was closed after 10 min idle");
    assert.equal(owned.size, 0);
    assert.deepEqual(owned.resolve(undefined), {});
  });

  test("the cap counts live sessions only: ended and idle-closed ids free their slot (AC8)", () => {
    const owned = new ConnectionSessions(2);
    assert.equal(owned.tryReserve(), undefined);
    owned.add("a");
    assert.equal(owned.tryReserve(), undefined);
    owned.add("b");
    assert.match(owned.tryReserve()!, /2/);

    owned.remove("a");
    assert.equal(owned.tryReserve(), undefined);
    owned.add("c");
    assert.match(owned.tryReserve()!, /2/);

    owned.markIdleClosed("b", "1 min");
    assert.equal(owned.tryReserve(), undefined);
  });

  test("a reservation holds a slot until it is added or cancelled, so parallel starts cannot exceed the cap", () => {
    const owned = new ConnectionSessions(1);
    assert.equal(owned.tryReserve(), undefined);
    assert.match(owned.tryReserve()!, /1/, "second start while the first is still launching");
    owned.cancelReservation();
    assert.equal(owned.tryReserve(), undefined);
  });

  test("the cap error names the limit and how to raise it", () => {
    const owned = new ConnectionSessions(1);
    owned.add("a");
    const err = owned.tryReserve()!;
    assert.match(err, /MAX_SESSIONS_PER_CONNECTION/);
    assert.match(err, /ui_end_session/);
  });

  test("the closed-after-idle memory is bounded to the most recent ids", () => {
    const owned = new ConnectionSessions(3);
    for (let i = 0; i < MAX_REMEMBERED_IDLE_CLOSES + 5; i++) owned.markIdleClosed(`s${i}`, "1 min");
    assert.equal(MAX_REMEMBERED_IDLE_CLOSES, 20);
    assert.equal(owned.resolve("s0").error, "Unknown session s0", "oldest forgotten");
    assert.equal(owned.resolve("s4").error, "Unknown session s4");
    assert.match(owned.resolve("s5").error!, /closed after 1 min idle/);
    assert.match(owned.resolve(`s${MAX_REMEMBERED_IDLE_CLOSES + 4}`).error!, /closed after/);
  });

  test("ids() lists the open sessions and drain() empties them", () => {
    const owned = new ConnectionSessions(3);
    owned.add("a");
    owned.add("b");
    assert.deepEqual(owned.ids(), ["a", "b"]);
    assert.deepEqual(owned.drain(), ["a", "b"]);
    assert.deepEqual(owned.ids(), []);
    assert.deepEqual(new ConnectionSessions(3).drain(), [], "a connection with no sessions: no-op");
  });
});

// ---------------------------------------------------------------------------
// Through a real MCP client
// ---------------------------------------------------------------------------

const PORT = 8765;
const BASE_URL = `http://localhost:${PORT}`;
const REPORTS_DIR = path.join(process.cwd(), "reports");

let server: ChildProcessWithoutNullStreams | undefined;
const writtenReports = new Set<string>();

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
  const proc = server;
  server = undefined;
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  proc.kill("SIGTERM");
  const killTimer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(killTimer);
}

interface Conn {
  client: Client;
  transport: StreamableHTTPClientTransport;
  /** Calls a tool, returning isError + the first text block. */
  call(name: string, args?: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  /** Starts a session and returns its id. */
  start(target: string): Promise<string>;
  /** Ends the connection the way a well-behaved client does: DELETE /mcp, then close. */
  hangUp(): Promise<void>;
}

const connections: Conn[] = [];

async function connect(): Promise<Conn> {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`));
  const client = new Client({ name: "multi-session-test", version: "0.0.0" });
  await client.connect(transport);
  const conn: Conn = {
    client,
    transport,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      return { isError: result.isError === true, text: result.content[0]?.text ?? "" };
    },
    async start(target) {
      const r = await conn.call("ui_start_session", { target });
      assert.equal(r.isError, false, r.text);
      const id = /Session ([0-9a-f-]{36}) started/.exec(r.text)?.[1];
      assert.ok(id, `no session id in: ${r.text}`);
      return id;
    },
    async hangUp() {
      await transport.terminateSession().catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
  connections.push(conn);
  return conn;
}

/** The report JSON a session wrote, found by its id (file names end in the first 8 chars). */
function reportFor(id: string): { path: string; json: any } | undefined {
  const name = readdirSync(REPORTS_DIR).find((f) => f.endsWith(`-${id.slice(0, 8)}.json`));
  if (!name) return undefined;
  const file = path.join(REPORTS_DIR, name);
  writtenReports.add(file);
  writtenReports.add(file.replace(/\.json$/, ".html"));
  return { path: file, json: JSON.parse(readFileSync(file, "utf8")) };
}

async function waitForReport(id: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const report = reportFor(id);
    if (report) return report;
    if (Date.now() > deadline) throw new Error(`no report written for session ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pageUrl = (body: string) => `data:text/html,${encodeURIComponent(`<!doctype html><title>t</title>${body}`)}`;
const PAGE_ONE = pageUrl('<h1>one</h1><button id="only-one">One</button>');
const PAGE_TWO = pageUrl('<h1>two</h1><button id="only-two">Two</button>');

/** Minimal valid arguments for a tool, built from its advertised JSON schema. */
function argsFor(tool: { inputSchema: { properties?: Record<string, any>; required?: string[] } }): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of tool.inputSchema.required ?? []) {
    const prop = tool.inputSchema.properties?.[key];
    const type = prop?.type;
    // An enum input (ui_dialog's `action`) only validates with one of its own values.
    args[key] = prop?.enum?.[0] ?? (type === "boolean" ? true : type === "number" || type === "integer" ? 1 : "x");
  }
  return args;
}

async function closeAllConnections() {
  for (const conn of connections.splice(0)) await conn.hangUp();
}

after(() => {
  for (const file of writtenReports) rmSync(file, { force: true });
});

describe("one connection, several sessions", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "600000", MAX_SESSIONS_PER_CONNECTION: "3" }));
  after(async () => {
    await closeAllConnections();
    await stopServer();
  });

  test("two sessions are independent: own page, own step label, own report (AC1-4, AC9)", async () => {
    const conn = await connect();
    const a = await conn.start("multi-A");
    const b = await conn.start("multi-B");
    assert.notEqual(a, b);

    assert.equal((await conn.call("ui_navigate", { url: PAGE_ONE, session_id: a })).isError, false);
    assert.equal((await conn.call("ui_navigate", { url: PAGE_TWO, session_id: b })).isError, false);

    // each id sees its own page
    assert.match((await conn.call("ui_get_page_state", { session_id: a })).text, /only-one/);
    assert.match((await conn.call("ui_get_page_state", { session_id: b })).text, /only-two/);
    const aSeesOne = await conn.call("ui_assert", { condition: "!!document.querySelector('#only-one')", session_id: a });
    assert.equal(aSeesOne.isError, false);
    assert.match(aSeesOne.text, /Assertion passed/);
    const bSeesOne = await conn.call("ui_assert", { condition: "!!document.querySelector('#only-one')", session_id: b });
    assert.match(bSeesOne.text, /Assertion failed/);

    // the step label belongs to one session
    await conn.call("ui_step", { label: "step only in A", session_id: a });
    await conn.call("ui_check", { condition: "true", session_id: a });
    await conn.call("ui_click", { selector: "#only-two", session_id: b });

    // ending A leaves B usable
    const endedA = await conn.call("ui_end_session", { session_id: a });
    assert.equal(endedA.isError, false, endedA.text);
    assert.match(endedA.text, new RegExp(`Session ${a} ended`));
    assert.match((await conn.call("ui_get_page_state", { session_id: b })).text, /only-two/);
    assert.match((await conn.call("ui_get_page_state", { session_id: a })).text, /Unknown session/);

    const endedB = await conn.call("ui_end_session", { session_id: b });
    assert.equal(endedB.isError, false, endedB.text);

    const reportA = reportFor(a)!.json;
    const reportB = reportFor(b)!.json;
    assert.equal(reportA.target, "multi-A");
    assert.equal(reportB.target, "multi-B");
    assert.equal(reportA.status, "passed");
    assert.equal(reportB.status, "failed", "B's failed assertion fails B only");

    const aActions = reportA.actions.map((x: any) => x.action);
    assert.ok(aActions.includes("ui_navigate") && aActions.includes("ui_step"));
    assert.equal(aActions.includes("ui_click"), false, "B's click never reaches A's report");
    assert.ok(reportA.actions.every((x: any) => !(x.args?.url === PAGE_TWO)), "B's navigation is not in A's report");
    const bClick = reportB.actions.find((x: any) => x.action === "ui_click");
    assert.ok(bClick);
    assert.equal(bClick.step, undefined, "a step set in A does not label B's actions");
    assert.ok(reportB.actions.every((x: any) => x.action !== "ui_step"));
    const aAfterStep = reportA.actions.filter((x: any) => x.action !== "ui_step" && x.step === "step only in A");
    assert.ok(aAfterStep.length >= 1, "A's later actions carry A's step label");
  });

  test("no session_id with exactly one open session behaves as today (AC5)", async () => {
    const conn = await connect();
    const only = await conn.start("single-session");
    assert.equal((await conn.call("ui_navigate", { url: PAGE_ONE })).isError, false);
    assert.match((await conn.call("ui_get_page_state")).text, /only-one/);
    const ended = await conn.call("ui_end_session");
    assert.equal(ended.isError, false, ended.text);
    assert.match(ended.text, new RegExp(`Session ${only} ended \\(passed\\)`));
    assert.equal(reportFor(only)!.json.actions[0].action, "ui_navigate");
  });

  test("ui_get_text with a session_id reads that session's page, and its text is not stored in the report (T030)", async () => {
    const conn = await connect();
    const a = await conn.start("text-A");
    const b = await conn.start("text-B");
    await conn.call("ui_navigate", { url: PAGE_ONE, session_id: a });
    await conn.call("ui_navigate", { url: PAGE_TWO, session_id: b });

    assert.deepEqual(await conn.call("ui_get_text", { selector: "h1", session_id: a }), { isError: false, text: "one" });
    assert.deepEqual(await conn.call("ui_get_text", { selector: "h1", session_id: b }), { isError: false, text: "two" });
    assert.equal((await conn.call("ui_get_text", { session_id: b })).text, "two\nTwo");
    // an element that only exists in the other session is a clear failure, not a cross-read
    const cross = await conn.call("ui_get_text", { selector: "#only-two", session_id: a });
    assert.equal(cross.isError, true);
    assert.match(cross.text, /No element matched/);
    // two sessions open and no id: refused, like every other session-aware tool
    const ambiguous = await conn.call("ui_get_text", { selector: "h1" });
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.text, /session_id/);
    assert.match((await conn.call("ui_get_text", { selector: "h1", session_id: "nope" })).text, /Unknown session/);

    await conn.call("ui_end_session", { session_id: a });
    await conn.call("ui_end_session", { session_id: b });
    const readsA = reportFor(a)!.json.actions.filter((x: any) => x.action === "ui_get_text");
    assert.equal(readsA.length, 2, "A's report holds its own two reads only (one ok, one failed)");
    assert.deepEqual(readsA.map((x: any) => x.ok), [true, false]);
    assert.deepEqual(readsA[0].args, { selector: "h1" }, "the text read is not stored in the args");
    assert.equal(readsA[0].detail, undefined);
    const readsB = reportFor(b)!.json.actions.filter((x: any) => x.action === "ui_get_text");
    assert.equal(readsB.length, 2);
  });

  test("every tool advertises an optional session_id, apart from ui_start_session (AC2)", async () => {
    const conn = await connect();
    const { tools } = await conn.client.listTools();
    assert.ok(tools.length >= 15);
    for (const tool of tools) {
      if (tool.name === "ui_start_session") continue;
      const props = (tool.inputSchema.properties ?? {}) as Record<string, any>;
      assert.equal(props.session_id?.type, "string", `${tool.name} has no session_id string`);
      assert.equal((tool.inputSchema.required ?? []).includes("session_id"), false, `${tool.name} requires session_id`);
    }
  });

  test("with two open sessions every tool called without session_id is an error listing both ids (AC6)", async () => {
    const conn = await connect();
    const a = await conn.start("ambig-A");
    const b = await conn.start("ambig-B");
    const { tools } = await conn.client.listTools();
    for (const tool of tools) {
      if (tool.name === "ui_start_session") continue;
      const r = await conn.call(tool.name, argsFor(tool as any));
      assert.equal(r.isError, true, `${tool.name} acted without a session_id`);
      assert.ok(r.text.includes(a) && r.text.includes(b), `${tool.name}: error does not list both ids: ${r.text}`);
    }
    // nothing was recorded: both sessions are still open and clean
    for (const id of [a, b]) {
      const ended = await conn.call("ui_end_session", { session_id: id });
      assert.equal(ended.isError, false, ended.text);
      assert.deepEqual(reportFor(id)!.json.actions, []);
    }
  });

  test("an unknown or ended session_id is Unknown session; with zero open it is not the legacy page (AC7)", async () => {
    const conn = await connect();
    const bogus = "00000000-0000-0000-0000-000000000000";
    for (const name of ["ui_navigate", "ui_get_page_state", "ui_end_session"]) {
      const r = await conn.call(name, { ...(name === "ui_navigate" ? { url: PAGE_ONE } : {}), session_id: bogus });
      assert.equal(r.isError, true);
      assert.equal(r.text, `Unknown session ${bogus}`);
    }
    const id = await conn.start("ended-then-used");
    await conn.call("ui_end_session", { session_id: id });
    assert.equal((await conn.call("ui_get_page_state", { session_id: id })).text, `Unknown session ${id}`);
    assert.equal((await conn.call("ui_end_session", { session_id: id })).text, `Unknown session ${id}`);
  });

  test("another connection's session id is Unknown session and its session is untouched (AC7)", async () => {
    const one = await connect();
    const two = await connect();
    const mine = await one.start("owner-session");
    await one.call("ui_navigate", { url: PAGE_ONE, session_id: mine });
    await two.start("intruder-own");

    for (const [name, args] of [
      ["ui_get_page_state", {}],
      ["ui_click", { selector: "#only-one" }],
      ["ui_end_session", {}],
    ] as const) {
      const r = await two.call(name, { ...args, session_id: mine });
      assert.equal(r.isError, true, name);
      assert.equal(r.text, `Unknown session ${mine}`, name);
    }
    assert.match((await one.call("ui_get_page_state", { session_id: mine })).text, /only-one/);
    assert.equal(reportFor(mine), undefined, "the intruder did not end it");

    await one.call("ui_end_session");
    await two.call("ui_end_session");
  });

  test("a session beyond the cap is refused with the cap in the message, and a freed slot works again (AC8)", async () => {
    const conn = await connect();
    const ids = [await conn.start("cap-1"), await conn.start("cap-2"), await conn.start("cap-3")];
    const over = await conn.call("ui_start_session", { target: "cap-4" });
    assert.equal(over.isError, true);
    assert.match(over.text, /3/);
    assert.match(over.text, /MAX_SESSIONS_PER_CONNECTION/);

    await conn.call("ui_end_session", { session_id: ids[0] });
    ids[0] = await conn.start("cap-5");

    for (const id of ids) await conn.call("ui_end_session", { session_id: id });
  });

  test("parallel starts cannot exceed the cap", async () => {
    const conn = await connect();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => conn.call("ui_start_session", { target: `race-${n}` })));
    const ok = results.filter((r) => !r.isError);
    assert.equal(ok.length, 3);
    assert.equal(results.filter((r) => r.isError).length, 2);
    for (const r of ok) {
      const id = /Session ([0-9a-f-]{36}) started/.exec(r.text)![1];
      await conn.call("ui_end_session", { session_id: id });
    }
  });

  test("closing the connection ends every session it owns and writes their reports (AC10)", async () => {
    const conn = await connect();
    const a = await conn.start("hangup-A");
    const b = await conn.start("hangup-B");
    await conn.call("ui_navigate", { url: PAGE_ONE, session_id: a });
    assert.equal(reportFor(a), undefined);

    await conn.hangUp();

    const reportA = await waitForReport(a);
    const reportB = await waitForReport(b);
    assert.equal(reportA.json.status, "passed");
    assert.equal(reportA.json.actions[0].action, "ui_navigate");
    assert.equal(reportB.json.target, "hangup-B");
  });

  test("closing a connection with no sessions is a no-op and the server stays healthy", async () => {
    const conn = await connect();
    await conn.hangUp();
    const health = await fetch(`${BASE_URL}/health`);
    assert.equal(health.status, 200);
  });

  test("no session open and no session_id still uses the legacy shared page", async () => {
    const conn = await connect();
    const r = await conn.call("ui_navigate", { url: PAGE_ONE });
    assert.equal(r.isError, false, r.text);
    assert.match((await conn.call("ui_get_page_state")).text, /only-one/);
  });
});

describe("idle auto-close through the server", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "500", MAX_SESSIONS_PER_CONNECTION: "2" }));
  after(async () => {
    await closeAllConnections();
    await stopServer();
  });

  test("an idle session closes with a timed_out report while a busy one lives on, and its slot frees (AC12-14)", async () => {
    const conn = await connect();
    const idle = await conn.start("idle-A");
    const busy = await conn.start("busy-B");
    await conn.call("ui_navigate", { url: PAGE_ONE, session_id: idle });

    // B is called every 200 ms for 1.4 s, almost three times the 500 ms idle limit
    const until = Date.now() + 1_400;
    while (Date.now() < until) {
      const r = await conn.call("ui_check", { condition: "true", session_id: busy });
      assert.equal(r.isError, false, r.text);
      await sleep(200);
    }

    const report = await waitForReport(idle);
    assert.equal(report.json.status, "timed_out");
    assert.equal(report.json.actions[0].action, "ui_navigate");
    assert.match(report.json.actions.at(-1).detail, /Closed after 0\.5 s idle/);

    const late = await conn.call("ui_get_page_state", { session_id: idle });
    assert.equal(late.isError, true);
    assert.equal(late.text, `Session ${idle} was closed after 0.5 s idle`);
    assert.equal((await conn.call("ui_end_session", { session_id: idle })).text, `Session ${idle} was closed after 0.5 s idle`);

    // the busy one is still usable, and A's slot is free again (cap is 2)
    assert.equal((await conn.call("ui_check", { condition: "true", session_id: busy })).isError, false);
    const replacement = await conn.start("idle-C");

    const endedBusy = await conn.call("ui_end_session", { session_id: busy });
    assert.equal(endedBusy.isError, false, endedBusy.text);
    assert.equal(reportFor(busy)!.json.status, "passed");
    await conn.call("ui_end_session", { session_id: replacement });
  });

  test("a ui_wait_for that outlasts the idle limit is not killed mid-call (edge case)", async () => {
    const conn = await connect();
    const id = await conn.start("long-wait");
    const page = pageUrl("<script>setTimeout(() => { window.ready = true; }, 1300);</script>");
    assert.equal((await conn.call("ui_navigate", { url: page, session_id: id })).isError, false);

    const waited = await conn.call("ui_wait_for", { condition: "window.ready === true", timeoutMs: 5000, session_id: id });
    assert.equal(waited.isError, false, waited.text);

    const ended = await conn.call("ui_end_session", { session_id: id });
    assert.equal(ended.isError, false, ended.text);
    assert.match(ended.text, /ended \(passed\)/, "still alive after a wait 2.6x the idle limit");
  });

  test("a session abandoned by a dropped connection is closed by the idle timer without any report loss", async () => {
    const conn = await connect();
    const id = await conn.start("abandoned");
    await conn.client.close(); // no DELETE: the client just vanishes
    const report = await waitForReport(id);
    assert.equal(report.json.status, "timed_out");
  });
});
