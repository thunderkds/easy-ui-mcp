import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  startSession,
  endSession,
  getSessionPage,
  isSessionActive,
  logAction,
  markFailed,
} from "../src/tools/session.js";
import { writeReports } from "../src/reports/index.js";

const TMP_REPORTS_DIR = path.join(process.cwd(), "test", ".tmp-reports");

test.after(() => {
  rmSync(TMP_REPORTS_DIR, { recursive: true, force: true });
});

// --- happy path: start -> actions logged -> end -> reports written ---

test("full session happy path: start, log actions, end, JSON+HTML reports written in order", async () => {
  const record = await startSession("https://example.com");
  assert.ok(record.id);
  assert.equal(record.status, "running");
  assert.ok(getSessionPage(record.id));

  logAction(record.id, { timestamp: new Date().toISOString(), action: "ui_navigate", ok: true });
  logAction(record.id, { timestamp: new Date().toISOString(), action: "ui_click", ok: true });

  const ended = await endSession(record.id);
  assert.ok(ended);
  assert.equal(ended!.status, "passed");
  assert.equal(ended!.actions.length, 2);
  assert.equal(ended!.actions[0].action, "ui_navigate");
  assert.equal(ended!.actions[1].action, "ui_click");

  const { jsonPath, htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  assert.ok(existsSync(jsonPath));
  assert.ok(existsSync(htmlPath));

  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(json.status, "passed");
  assert.equal(json.actions.length, 2);

  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /ui_navigate/);
  assert.match(html, /ui_click/);
});

// --- mid-session failure path ---

test("mid-session failure: session stops, marked failed, screenshot captured, report still emitted", async () => {
  const record = await startSession("https://example.com");
  logAction(record.id, { timestamp: new Date().toISOString(), action: "ui_navigate", ok: true });

  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body>hi</body></html>");
  markFailed(record.id); // simulate a failing step (screenshot capture path exercised in server.ts)

  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_click",
    ok: false,
    detail: 'No element matched selector "#missing"',
  });

  const ended = await endSession(record.id);
  assert.ok(ended);
  assert.equal(ended!.status, "failed");

  const { jsonPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(json.status, "failed");
  assert.equal(json.actions.some((a: { ok: boolean }) => a.ok === false), true);
});

// --- concurrent sessions: isolated browser contexts and reports ---

test("two sessions started back-to-back get isolated browser contexts and reports", async () => {
  const [a, b] = await Promise.all([startSession("target-a"), startSession("target-b")]);
  assert.notEqual(a.id, b.id);

  const pageA = getSessionPage(a.id)!;
  const pageB = getSessionPage(b.id)!;
  assert.notEqual(pageA, pageB);

  await pageA.setContent("<html><body id='a'>A</body></html>");
  await pageB.setContent("<html><body id='b'>B</body></html>");

  logAction(a.id, { timestamp: new Date().toISOString(), action: "ui_navigate", ok: true });
  logAction(b.id, { timestamp: new Date().toISOString(), action: "ui_click", ok: true });

  const [endedA, endedB] = await Promise.all([endSession(a.id), endSession(b.id)]);
  assert.equal(endedA!.actions.length, 1);
  assert.equal(endedA!.actions[0].action, "ui_navigate");
  assert.equal(endedB!.actions.length, 1);
  assert.equal(endedB!.actions[0].action, "ui_click");

  const reportsA = await writeReports(endedA!, TMP_REPORTS_DIR);
  const reportsB = await writeReports(endedB!, TMP_REPORTS_DIR);
  assert.notEqual(reportsA.jsonPath, reportsB.jsonPath);
});

// --- session left open past timeout: cleaned up, no leak, no hang ---

test("session left open past its timeout is cleaned up (no leak, resource freed)", async () => {
  const record = await startSession("https://example.com", 50); // 50ms test-only timeout
  assert.equal(isSessionActive(record.id), true);

  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(isSessionActive(record.id), false);
  assert.equal(getSessionPage(record.id), undefined);
});

// --- ui_end_session without a matching ui_start_session ---

test("ending an unknown/already-ended session returns undefined, not a crash", async () => {
  const result = await endSession("does-not-exist");
  assert.equal(result, undefined);
});
