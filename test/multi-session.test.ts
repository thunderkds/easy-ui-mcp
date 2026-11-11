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
    // An enum input (ui_dialog's `action`) only validates with one of its own values, and a
    // bounded number (ui_set_viewport's width/height) with one inside its range.
    args[key] = prop?.enum?.[0] ?? (type === "boolean" ? true : type === "number" || type === "integer" ? (prop?.minimum ?? 1) : "x");
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
    assert.match((await conn.call("ui_get_page_state", { session_id: a })).text, /"One"/);
    assert.match((await conn.call("ui_get_page_state", { session_id: b })).text, /"Two"/);
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
    assert.match((await conn.call("ui_get_page_state", { session_id: b })).text, /"Two"/);
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
    assert.match((await conn.call("ui_get_page_state")).text, /"One"/);
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

  test("two sessions keep their own viewport; ui_set_viewport with a session_id resizes only that one (T032)", async () => {
    const conn = await connect();
    const startAt = async (target: string, viewport: { width: number; height: number }) => {
      const r = await conn.call("ui_start_session", { target, viewport });
      assert.equal(r.isError, false, r.text);
      assert.match(r.text, new RegExp(`viewport ${viewport.width}x${viewport.height}`));
      return /Session ([0-9a-f-]{36}) started/.exec(r.text)![1];
    };
    const phone = await startAt("viewport-phone", { width: 375, height: 812 });
    const tablet = await startAt("viewport-tablet", { width: 768, height: 1024 });
    for (const id of [phone, tablet]) {
      assert.equal((await conn.call("ui_navigate", { url: PAGE_ONE, session_id: id })).isError, false);
    }
    const is = async (id: string, w: number) =>
      (await conn.call("ui_assert", { condition: `innerWidth === ${w}`, session_id: id })).text;
    assert.match(await is(phone, 375), /Assertion passed/);
    assert.match(await is(tablet, 768), /Assertion passed/);

    const resized = await conn.call("ui_set_viewport", { width: 1000, height: 700, session_id: phone });
    assert.equal(resized.isError, false, resized.text);
    assert.match(await is(phone, 1000), /Assertion passed/, "the targeted session resized");
    assert.match(await is(tablet, 768), /Assertion passed/, "the other session kept its own size");

    // an ambiguous call (two open, no id) is refused rather than resizing one of them
    const ambiguous = await conn.call("ui_set_viewport", { width: 500, height: 600 });
    assert.equal(ambiguous.isError, true);
    assert.match(ambiguous.text, /session_id/);

    for (const id of [phone, tablet]) assert.equal((await conn.call("ui_end_session", { session_id: id })).isError, false);
    assert.equal(reportFor(phone)!.json.settings.viewport.width, 375, "the report keeps the size the session started with");
    assert.equal(reportFor(tablet)!.json.settings.viewport.width, 768);
    assert.ok(reportFor(phone)!.json.actions.some((x: any) => x.action === "ui_set_viewport"));
    assert.ok(reportFor(tablet)!.json.actions.every((x: any) => x.action !== "ui_set_viewport"));
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
    assert.match((await one.call("ui_get_page_state", { session_id: mine })).text, /"One"/);
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
    assert.match((await conn.call("ui_get_page_state")).text, /"One"/);
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

// ---------------------------------------------------------------------------
// T033 — tabs, notices and logs belong to one session
// ---------------------------------------------------------------------------

describe("T033: tabs and notices are per session", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "600000", MAX_SESSIONS_PER_CONNECTION: "3" }));
  after(async () => {
    await closeAllConnections();
    await stopServer();
  });

  /** Every text block of a reply: the notices ride as an extra block after the main one. */
  async function replyTexts(conn: Conn, name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await conn.client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[] };
    return result.content.map((c) => c.text).join("\n");
  }

  test("a popup opened in A is announced on A's replies only, and ui_tabs list on B still shows 1 tab", async () => {
    const conn = await connect();
    const a = await conn.start("tabs-A");
    const b = await conn.start("tabs-B");
    await conn.call("ui_navigate", { url: pageUrl('<a id="l" target="_blank" href="about:blank">open</a>'), session_id: a });
    await conn.call("ui_navigate", { url: PAGE_TWO, session_id: b });

    const click = await replyTexts(conn, "ui_click", { selector: "#l", session_id: a });
    // B speaks in between: it must never carry A's notice, whether or not A's has been delivered yet.
    const bReply = await replyTexts(conn, "ui_get_page_state", { session_id: b });
    assert.doesNotMatch(bReply, /New tab opened/);
    const aReply = /New tab opened/.test(click) ? click : await replyTexts(conn, "ui_get_page_state", { session_id: a });
    assert.match(aReply, /New tab opened: about:blank \(tab 2\)/);

    const tabsA = JSON.parse((await conn.call("ui_tabs", { action: "list", session_id: a })).text);
    const tabsB = JSON.parse((await conn.call("ui_tabs", { action: "list", session_id: b })).text);
    assert.equal(tabsA.length, 2);
    assert.equal(tabsB.length, 1);

    // the notice was delivered once: A's next reply no longer carries it
    assert.doesNotMatch(await replyTexts(conn, "ui_get_page_state", { session_id: a }), /New tab opened/);

    // logs are per session too
    await conn.call("ui_navigate", { url: pageUrl("<script>console.error('only in A')</script>"), session_id: a });
    await sleep(300);
    assert.match((await conn.call("ui_get_logs", { since: "start", session_id: a })).text, /only in A/);
    assert.doesNotMatch((await conn.call("ui_get_logs", { since: "start", session_id: b })).text, /only in A/);

    await conn.call("ui_end_session", { session_id: a });
    await conn.call("ui_end_session", { session_id: b });
    for (const id of [a, b]) {
      const report = reportFor(id);
      assert.ok(report, `report for ${id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// T040: compact page state and refs, through a real MCP client
// ---------------------------------------------------------------------------

describe("T040: compact page state and refs", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "600000", MAX_SESSIONS_PER_CONNECTION: "3" }));
  after(async () => {
    await closeAllConnections();
    await stopServer();
  });

  const COUNTER_PAGE = pageUrl(
    `<p id="out">idle</p>
     <button id="inc" onclick="document.getElementById('out').textContent='clicked'">Increase</button>
     <input aria-label="Name" id="nm">`
  );

  /** The ref the compact reply gives the element line carrying `name`. */
  function refOf(text: string, name: string): string {
    const match = new RegExp(`^(@e\\d+) \\S+ "${name}"`, "m").exec(text);
    assert.ok(match, `no ref for "${name}" in:\n${text}`);
    return match[1];
  }

  test("AC1/AC2: the default reply is compact text without selectors; format:full is today's JSON without refs", async () => {
    const conn = await connect();
    const id = await conn.start("compact-default");
    await conn.call("ui_navigate", { url: COUNTER_PAGE, session_id: id });

    const compact = await conn.call("ui_get_page_state", { session_id: id });
    assert.equal(compact.isError, false, compact.text);
    assert.match(compact.text, /^url: data:text\/html/);
    assert.match(compact.text, /^title: t$/m);
    assert.match(compact.text, /^@e1 button "Increase"$/m);
    assert.match(compact.text, /^@e2 textbox "Name"$/m);
    assert.doesNotMatch(compact.text, /#inc|#nm|selector|\{"/, "no selector, no JSON");
    assert.deepEqual(compact, await conn.call("ui_get_page_state", { format: "compact", session_id: id }));

    const full = await conn.call("ui_get_page_state", { format: "full", session_id: id });
    assert.equal(full.isError, false, full.text);
    const parsed = JSON.parse(full.text);
    assert.deepEqual(Object.keys(parsed), ["ok", "url", "title", "elements", "messages"]);
    assert.deepEqual(parsed.elements, [
      { role: "button", name: "Increase", selector: "#inc" },
      { role: "textbox", name: "Name", selector: "#nm" },
    ]);
    assert.doesNotMatch(full.text, /@e\d|"ref"/);

    // the agent saw no refs in the full reply, so the ones from the compact snapshot are gone
    const old = await conn.call("ui_click", { selector: "@e1", session_id: id });
    assert.equal(old.isError, true);
    assert.match(old.text, /@e1.*ui_get_page_state/);
    await conn.call("ui_end_session", { session_id: id });
  });

  test("AC3/AC6: click and fill by ref act on the listed element; the echo, the action log and the report show selectors, never a ref", async () => {
    const conn = await connect();
    const id = await conn.start("refs-report");
    await conn.call("ui_navigate", { url: COUNTER_PAGE, session_id: id });
    const state = await conn.call("ui_get_page_state", { session_id: id });

    const clicked = await conn.call("ui_click", { selector: refOf(state.text, "Increase"), session_id: id });
    assert.equal(clicked.isError, false, clicked.text);
    assert.match(clicked.text, /"#inc"/, "the reply names the resolved selector");
    assert.equal((await conn.call("ui_get_text", { selector: "#out", session_id: id })).text, "clicked");
    const filled = await conn.call("ui_fill", { selector: refOf(state.text, "Name"), value: "Bob", session_id: id });
    assert.equal(filled.isError, false, filled.text);
    assert.match((await conn.call("ui_assert", { condition: "document.getElementById('nm').value === 'Bob'", session_id: id })).text, /passed/);
    // a CSS selector keeps working next to refs
    assert.equal((await conn.call("ui_click", { selector: "#inc", session_id: id })).isError, false);
    // ref arguments of read tools resolve too
    assert.equal((await conn.call("ui_get_text", { selector: refOf(state.text, "Increase"), session_id: id })).text, "Increase");

    await conn.call("ui_end_session", { session_id: id });
    const report = reportFor(id)!;
    const actions = report.json.actions;
    const click = actions.find((x: any) => x.action === "ui_click");
    const fill = actions.find((x: any) => x.action === "ui_fill");
    assert.equal(click.args.selector, "#inc");
    assert.equal(fill.args.selector, "#nm");
    assert.equal(actions.find((x: any) => x.action === "ui_get_text" && x.args?.selector === "#inc")?.ok, true);
    assert.doesNotMatch(JSON.stringify(actions), /@[eo]\d/, "no bare ref in the report JSON");
    assert.doesNotMatch(readFileSync(report.path.replace(/\.json$/, ".html"), "utf8"), /@[eo]\d/, "no bare ref in the HTML report");
  });

  test("T045 SC8/AC11: a click by ref after a compact snapshot records the selector built when the ref was used, and the second of two look-alikes is the one clicked", async () => {
    const conn = await connect();
    const id = await conn.start("lazy-ref-report");
    await conn.call(
      "ui_navigate",
      {
        url: pageUrl(
          `<p id="out"></p><button onclick="document.getElementById('out').textContent='first'">Item</button>
           <button onclick="document.getElementById('out').textContent='second'">Item</button>`
        ),
        session_id: id,
      }
    );
    const state = await conn.call("ui_get_page_state", { session_id: id });
    assert.match(state.text, /^@e1 button "Item"$/m);
    assert.match(state.text, /^@e2 button "Item"$/m);
    assert.doesNotMatch(state.text, /nth=|role=/, "no selector in the compact reply");

    const clicked = await conn.call("ui_click", { selector: "@e2", session_id: id });
    assert.equal(clicked.isError, false, clicked.text);
    assert.equal((await conn.call("ui_get_text", { selector: "#out", session_id: id })).text, "second");
    await conn.call("ui_end_session", { session_id: id });

    const click = reportFor(id)!.json.actions.find((x: any) => x.action === "ui_click");
    assert.equal(click.ok, true);
    assert.match(click.args.selector, /^role=button\[name="Item"\] >> nth=1$/, "the resolved selector, not the ref");
  });

  test("AC4/AC5/AC7: a ref in another session, a changed page, an unknown number or no snapshot all fail and act on nothing", async () => {
    const conn = await connect();
    const a = await conn.start("refs-A");
    const b = await conn.start("refs-B");
    await conn.call("ui_navigate", { url: COUNTER_PAGE, session_id: a });
    await conn.call("ui_navigate", { url: COUNTER_PAGE, session_id: b });
    const stateA = await conn.call("ui_get_page_state", { session_id: a });

    // B never took a snapshot: A's @e1 is nothing there
    for (const ref of [refOf(stateA.text, "Increase"), "@e999", "@e0"]) {
      const r = await conn.call("ui_click", { selector: ref, session_id: b });
      assert.equal(r.isError, true, ref);
      assert.match(r.text, new RegExp(`${ref}.*ui_get_page_state`), ref);
    }
    assert.equal((await conn.call("ui_get_text", { selector: "#out", session_id: b })).text, "idle");

    // A's page changes under the ref: same id, a look-alike node
    const swap = await conn.call("ui_assert", {
      condition: "(() => { const old = document.getElementById('inc'); old.replaceWith(old.cloneNode(true)); return true; })()",
      session_id: a,
    });
    assert.equal(swap.isError, false, swap.text);
    const stale = await conn.call("ui_click", { selector: "@e1", session_id: a });
    assert.equal(stale.isError, true);
    assert.match(stale.text, /@e1.*stale.*ui_get_page_state/);
    assert.equal((await conn.call("ui_get_text", { selector: "#out", session_id: a })).text, "idle", "nothing was clicked");
    // fresh snapshot, fresh refs
    const again = await conn.call("ui_get_page_state", { session_id: a });
    assert.equal((await conn.call("ui_click", { selector: refOf(again.text, "Increase"), session_id: a })).isError, false);
    assert.equal((await conn.call("ui_get_text", { selector: "#out", session_id: a })).text, "clicked");

    await conn.call("ui_end_session", { session_id: a });
    await conn.call("ui_end_session", { session_id: b });
    const failedB = reportFor(b)!.json.actions.filter((x: any) => x.action === "ui_click");
    assert.ok(
      failedB.length > 0 && failedB.every((x: any) => x.ok === false && x.soft === true),
      "a refused ref is a soft failed step in the report"
    );
  });

  test("a refused ref is a soft step: the session still passes and no failure screenshot is taken for it", async () => {
    const conn = await connect();
    const id = await conn.start("refs-soft");
    await conn.call("ui_navigate", { url: COUNTER_PAGE, session_id: id });
    const refused = await conn.call("ui_click", { selector: "@e1", session_id: id }); // no snapshot yet
    assert.equal(refused.isError, true, "the tool reply is still an error");
    assert.match(refused.text, /@e1.*ui_get_page_state/);
    // the documented retry path works and is a normal hard-checked step
    const state = await conn.call("ui_get_page_state", { session_id: id });
    assert.equal((await conn.call("ui_click", { selector: refOf(state.text, "Increase"), session_id: id })).isError, false);

    const ended = await conn.call("ui_end_session", { session_id: id });
    assert.match(ended.text, /ended \(passed\)/, ended.text);
    const report = reportFor(id)!.json;
    assert.equal(report.status, "passed", "(a) a refused ref alone does not fail the session");
    const step = report.actions.find((x: any) => x.action === "ui_click" && x.ok === false);
    assert.ok(step, "the refused click is in the report");
    assert.equal(step.soft, true);
    assert.deepEqual(step.args, { selector: "@e1" }, "the ref the agent tried is the step's target");
    assert.match(step.detail, /@e1.*ui_get_page_state/);
    assert.equal(report.failureScreenshot, undefined, "(b) no failure screenshot for a refused ref");
  });

  test("AC3: ui_drag with two refs, ui_scroll with a container ref and ui_press_key with a selector ref act on the listed elements", async () => {
    const conn = await connect();
    const id = await conn.start("refs-actions");
    await conn.call("ui_navigate", {
      url: pageUrl(
        `<ul id="list" style="user-select:none"><li role="option" id="A">Alpha</li><li role="option" id="B">Bravo</li><li role="option" id="C">Charlie</li></ul>
         <div role="listbox" aria-label="Panel" id="panel" style="height:50px;overflow:auto"><div style="height:600px">tall</div></div>
         <input aria-label="Field" id="field" onkeydown="document.title='key:'+event.key">
         <script>
           var dragged = null;
           document.addEventListener('pointerdown', (e) => { dragged = e.target.closest('li'); });
           document.addEventListener('pointerup', (e) => {
             const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('li');
             if (dragged && over && over !== dragged) over.after(dragged);
             dragged = null;
           });
         </script>`
      ),
      session_id: id,
    });
    const state = await conn.call("ui_get_page_state", { session_id: id });

    const dragged = await conn.call("ui_drag", { from: refOf(state.text, "Alpha"), to: refOf(state.text, "Charlie"), session_id: id });
    assert.equal(dragged.isError, false, dragged.text);
    assert.match((await conn.call("ui_assert", { condition: "[...document.querySelectorAll('li')].map((e) => e.id).join('') === 'BCA'", session_id: id })).text, /passed/);

    const scrolled = await conn.call("ui_scroll", { container: refOf(state.text, "Panel"), session_id: id });
    assert.equal(scrolled.isError, false, scrolled.text);
    assert.match((await conn.call("ui_assert", { condition: "document.getElementById('panel').scrollTop > 0", session_id: id })).text, /passed/);

    const pressed = await conn.call("ui_press_key", { key: "Enter", selector: refOf(state.text, "Field"), session_id: id });
    assert.equal(pressed.isError, false, pressed.text);
    assert.match((await conn.call("ui_assert", { condition: "document.title === 'key:Enter'", session_id: id })).text, /passed/);

    await conn.call("ui_end_session", { session_id: id });
    const actions = reportFor(id)!.json.actions;
    const drag = actions.find((x: any) => x.action === "ui_drag");
    assert.deepEqual([drag.args.from, drag.args.to], ["#A", "#C"]);
    assert.doesNotMatch(JSON.stringify(actions), /@[eo]\d/);
  });

  test("AC3: ui_click_outside accepts the @o1 ref of the open dialog", async () => {
    const conn = await connect();
    const id = await conn.start("refs-overlay");
    await conn.call("ui_navigate", {
      url: pageUrl(
        `<p id="state">open</p>
         <div id="backdrop" style="position:fixed;inset:0;background:#0006"
              onclick="document.getElementById('state').textContent='closed';this.remove();document.getElementById('dlg').remove()"></div>
         <div id="dlg" role="dialog" aria-modal="true" aria-label="Confirm" style="position:fixed;inset:20%;background:#fff"><button>Inner</button></div>`
      ),
      session_id: id,
    });
    const state = await conn.call("ui_get_page_state", { session_id: id });
    assert.match(state.text, /^overlay @o1 dialog "Confirm" modal$/m);
    const outside = await conn.call("ui_click_outside", { selector: "@o1", session_id: id });
    assert.equal(outside.isError, false, outside.text);
    assert.equal((await conn.call("ui_get_text", { selector: "#state", session_id: id })).text, "closed");
    await conn.call("ui_end_session", { session_id: id });
  });
});

// ---------------------------------------------------------------------------
// T043: snapshot scope
// ---------------------------------------------------------------------------

describe("T043: viewport and within on ui_get_page_state", () => {
  before(() => startServer({ SESSION_TIMEOUT_MS: "600000", MAX_SESSIONS_PER_CONNECTION: "3" }));
  after(async () => {
    await closeAllConnections();
    await stopServer();
  });

  const SCOPED_PAGE = pageUrl(
    `<button>Top</button>
     <div role="listbox" aria-label="Panel"><button>Inside A</button><button>Inside B</button></div>
     <div style="height:3000px"></div>
     <button>Bottom</button>`
  );

  test("viewport and within (selector and ref) scope the compact and the full reply, say so, and a bad within is a soft refusal", async () => {
    const conn = await connect();
    const id = await conn.start("scope");
    await conn.call("ui_navigate", { url: SCOPED_PAGE, session_id: id });

    const everything = await conn.call("ui_get_page_state", { session_id: id });
    assert.doesNotMatch(everything.text, /^note:/m, "no argument: no scope note");
    assert.match(everything.text, /"Bottom"/);

    const onScreen = await conn.call("ui_get_page_state", { viewport: true, session_id: id });
    assert.equal(onScreen.isError, false, onScreen.text);
    assert.doesNotMatch(onScreen.text, /"Bottom"/);
    assert.match(onScreen.text, /^@e1 button "Top"$/m);
    assert.match(onScreen.text, /^note: Showing 4 of 5 elements \(viewport only\); scroll, or call without viewport, for the rest$/m);

    const bySelector = await conn.call("ui_get_page_state", { within: "[role=listbox]", session_id: id });
    assert.equal(bySelector.isError, false, bySelector.text);
    assert.match(bySelector.text, /^@e1 button "Inside A"$/m);
    assert.match(bySelector.text, /^@e2 button "Inside B"$/m);
    assert.doesNotMatch(bySelector.text, /"Top"|"Bottom"/);
    assert.match(bySelector.text, /^note: Showing 2 of 5 elements \(within "\[role=listbox\]"\)/m);

    const state = await conn.call("ui_get_page_state", { session_id: id });
    const panel = /^(@e\d+) listbox "Panel"$/m.exec(state.text)![1];
    const byRef = await conn.call("ui_get_page_state", { within: panel, session_id: id });
    assert.equal(byRef.isError, false, byRef.text);
    assert.match(byRef.text, /^@e1 button "Inside A"$/m);
    assert.match(byRef.text, /within /);

    const full = await conn.call("ui_get_page_state", { format: "full", viewport: true, within: "[role=listbox]", session_id: id });
    const parsed = JSON.parse(full.text);
    assert.deepEqual(parsed.elements.map((e: any) => e.name), ["Inside A", "Inside B"]);
    assert.match(parsed.note, /^Showing 2 of 5 elements \(viewport, within /);

    for (const within of [".missing", "button"]) {
      const bad = await conn.call("ui_get_page_state", { within, session_id: id });
      assert.equal(bad.isError, true, within);
      assert.doesNotMatch(bad.text, /^@e\d/m);
    }
    const stale = await conn.call("ui_get_page_state", { within: "@e99", session_id: id });
    assert.equal(stale.isError, true);
    assert.match(stale.text, /@e99.*ui_get_page_state/);

    const ended = await conn.call("ui_end_session", { session_id: id });
    assert.match(ended.text, /ended \(passed\)/, ended.text);
    assert.equal(reportFor(id)!.json.status, "passed", "a mistaken scope does not fail the session");
  });
});
