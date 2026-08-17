// T014 — rendering logic. `describe`, `groupIntoSteps`, and `formatDuration` are
// pure, so they are tested here without a browser or a session: these are the
// cheapest and highest-value tests in the task.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, groupIntoSteps, formatDuration, writeReports } from "../src/reports/index.js";
import type { LoggedAction, SessionRecord } from "../src/tools/session.js";

const TMP_REPORTS_DIR = path.join(process.cwd(), "test", ".tmp-reports-t014");

test.after(() => {
  rmSync(TMP_REPORTS_DIR, { recursive: true, force: true });
});

function action(partial: Partial<LoggedAction> & { action: string }): LoggedAction {
  return { timestamp: "2026-08-17T10:00:00.000Z", ok: true, ...partial };
}

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "test-id",
    target: "test target",
    status: "passed",
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: "2026-08-17T10:00:05.000Z",
    actions: [],
    ...partial,
  };
}

// --- describe(): a readable sentence per action ---

test("describe renders each action type as a sentence, never a JSON dump", () => {
  assert.equal(describe(action({ action: "ui_step", args: { label: "Log in" } })), "Log in");
  assert.equal(
    describe(action({ action: "ui_navigate", args: { url: "http://localhost:8080" } })),
    "Opened http://localhost:8080"
  );
  assert.equal(describe(action({ action: "ui_click", args: { selector: "#save" } })), "Clicked #save");
  assert.equal(
    describe(action({ action: "ui_fill", args: { selector: "#user", value: "jcarlin" } })),
    "Filled #user"
  );
  assert.equal(describe(action({ action: "ui_assert", args: { condition: "x === 1" } })), "Asserted x === 1");
  assert.equal(describe(action({ action: "ui_check", args: { condition: "y" } })), "Checked y");
  assert.equal(describe(action({ action: "ui_wait_for", args: { condition: "z" } })), "Waited for z");
  assert.equal(describe(action({ action: "ui_take_screenshot" })), "Took a screenshot");
});

test("describe truncates a very long value so one action stays one line", () => {
  const url = `http://localhost:8080/${"x".repeat(400)}`;
  const text = describe(action({ action: "ui_navigate", args: { url } }));
  assert.ok(text.length < 200, `expected a truncated line, got ${text.length} chars`);
  assert.match(text, /… \(422 chars\)$/);
});

test("describe falls back to the tool name for an unknown action, and never throws on missing args", () => {
  assert.equal(describe(action({ action: "android_tap" })), "android_tap");
  assert.equal(describe(action({ action: "ui_click" })), "Clicked an element");
  assert.equal(describe(action({ action: "ui_navigate" })), "Opened the page");
});

// --- groupIntoSteps() ---

test("actions are grouped under the step label in force when they were recorded", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_step", args: { label: "Log in" }, step: "Log in" }),
    action({ action: "ui_fill", step: "Log in" }),
    action({ action: "ui_step", args: { label: "Toggle" }, step: "Toggle" }),
    action({ action: "ui_click", step: "Toggle" }),
    action({ action: "ui_assert", step: "Toggle" }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Log in");
  assert.equal(groups[0].actions.length, 2);
  assert.equal(groups[1].label, "Toggle");
  assert.equal(groups[1].actions.length, 3);
});

test("a session with no ui_step calls renders as one implicit group", () => {
  const groups = groupIntoSteps([action({ action: "ui_navigate" }), action({ action: "ui_click" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, undefined);
  assert.equal(groups[0].actions.length, 2);
});

test("actions before the first ui_step stay in their own leading group", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_navigate" }),
    action({ action: "ui_step", args: { label: "Log in" }, step: "Log in" }),
    action({ action: "ui_fill", step: "Log in" }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, undefined, "leading actions must not be absorbed into the first label");
  assert.equal(groups[0].actions.length, 1);
  assert.equal(groups[1].label, "Log in");
});

test("two consecutive ui_step calls with nothing between them each get their own group", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_step", args: { label: "A" }, step: "A" }),
    action({ action: "ui_step", args: { label: "B" }, step: "B" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["A", "B"]
  );
});

test("repeated ui_step labels still start distinct groups", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_step", args: { label: "Retry" }, step: "Retry" }),
    action({ action: "ui_click", step: "Retry" }),
    action({ action: "ui_step", args: { label: "Retry" }, step: "Retry" }),
    action({ action: "ui_assert", step: "Retry" }),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.actions.length), [2, 2]);
});

test("groupIntoSteps on an empty action list returns no groups", () => {
  assert.deepEqual(groupIntoSteps([]), []);
});

// --- formatDuration() ---

test("formatDuration renders ms under a second and seconds above it", () => {
  assert.equal(formatDuration("2026-08-17T10:00:00.000Z", "2026-08-17T10:00:00.407Z"), "407ms");
  assert.equal(formatDuration("2026-08-17T10:00:00.000Z", "2026-08-17T10:00:05.000Z"), "5.0s");
});

test("formatDuration returns undefined rather than NaN when an endpoint is missing", () => {
  assert.equal(formatDuration("2026-08-17T10:00:00.000Z", undefined), undefined);
  assert.equal(formatDuration(undefined, "2026-08-17T10:00:00.000Z"), undefined);
  assert.equal(formatDuration("not-a-date", "2026-08-17T10:00:00.000Z"), undefined);
});

// --- rendered document ---

test("the report leads with a verdict summary, not the raw log", async () => {
  const { htmlPath } = await writeReports(
    record({
      actions: [
        action({ action: "ui_step", args: { label: "Log in" }, step: "Log in" }),
        action({ action: "ui_fill", args: { selector: "#user", value: "jcarlin" }, step: "Log in" }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /verdict-box passed/);
  assert.match(html, /1 step\(s\) · 2 actions · 0 failed/);
  assert.match(html, /took 5\.0s/);
  assert.match(html, /Log in/);
  assert.match(html, /Filled #user/);
  assert.doesNotMatch(html, /jcarlin/, "filled values must not leak into the HTML report");
  // Raw log present but demoted.
  assert.match(html, /<details>[\s\S]*Raw action log \(2\)/);
});

test("a step containing a hard failure is marked failed; a soft check alone is not", async () => {
  const { htmlPath } = await writeReports(
    record({
      status: "failed",
      actions: [
        action({ action: "ui_step", args: { label: "Soft only" }, step: "Soft only" }),
        action({ action: "ui_check", ok: false, soft: true, detail: "Check evaluated false", step: "Soft only" }),
        action({ action: "ui_step", args: { label: "Hard fail" }, step: "Hard fail" }),
        action({ action: "ui_assert", ok: false, detail: "Assertion evaluated false", step: "Hard fail" }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /section class="step soft"[\s\S]*PASSED \(with checks\)/);
  assert.match(html, /section class="step fail"[\s\S]*FAILED/);
});

test("step labels and details are HTML-escaped", async () => {
  const { htmlPath } = await writeReports(
    record({
      actions: [
        action({
          action: "ui_step",
          args: { label: "<script>alert(1)</script>" },
          step: "<script>alert(1)</script>",
        }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("browser problems are listed and explicitly do not change the verdict", async () => {
  const { htmlPath } = await writeReports(
    record({
      status: "passed",
      actions: [action({ action: "ui_navigate" })],
      issues: [
        { timestamp: "2026-08-17T10:00:01.000Z", kind: "console", text: "TypeError: boom" },
        {
          timestamp: "2026-08-17T10:00:02.000Z",
          kind: "requestfailed",
          text: "GET http://x/api — net::ERR_FAILED",
        },
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /Browser problems \(2\)/);
  assert.match(html, /TypeError: boom/);
  assert.match(html, /net::ERR_FAILED/);
  assert.match(html, /do not change the session verdict/);
  assert.match(html, /verdict-box passed/, "console errors must not flip the verdict");
});

test("a session that never ended renders 'unknown' duration, not NaN", async () => {
  const { htmlPath } = await writeReports(
    record({ endedAt: undefined, actions: [action({ action: "ui_navigate" })] }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /took unknown/);
  assert.doesNotMatch(html, /NaN/);
});

test("the report is self-contained: no external requests", async () => {
  const { htmlPath } = await writeReports(
    record({ actions: [action({ action: "ui_navigate", args: { url: "http://localhost:8080/app" } })] }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  // The only http(s) strings allowed are ones the session itself recorded (the
  // navigated URL), never a stylesheet/script/font the browser would go fetch.
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /@import/);
});

test("a 120-action session still renders", async () => {
  const many: LoggedAction[] = [];
  for (let i = 0; i < 120; i += 1) {
    if (i % 20 === 0) {
      many.push(action({ action: "ui_step", args: { label: `Step ${i / 20}` }, step: `Step ${i / 20}` }));
    }
    many.push(action({ action: "ui_click", args: { selector: `#el-${i}` }, step: `Step ${Math.floor(i / 20)}` }));
  }

  const { htmlPath } = await writeReports(record({ actions: many }), TMP_REPORTS_DIR);
  assert.ok(existsSync(htmlPath));
  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /Raw action log \(126\)/);
});
