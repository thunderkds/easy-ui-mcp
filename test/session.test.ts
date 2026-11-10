import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import {
  startSession,
  endSession,
  getSessionPage,
  isSessionActive,
  logAction,
  markFailed,
  isFatalOutcome,
  claimFailureScreenshot,
  setCurrentStep,
  getCurrentStep,
  MAX_PAGE_ISSUES,
  getSessionLogs,
  takeNotices,
  listTabs,
  switchTab,
  closeTab,
} from "../src/tools/session.js";
import { waitForCondition, classifyCheckOutcome } from "../src/tools/web.js";
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

// ---------------------------------------------------------------------------
// T013 — soft checks, waits, screenshot budget
// ---------------------------------------------------------------------------

// --- AC4 regression guard: ui_assert semantics must not move (write me first) ---

test("REGRESSION: a hard failing outcome is still fatal (ui_assert semantics unchanged)", () => {
  const entry = {
    timestamp: new Date().toISOString(),
    action: "ui_assert",
    ok: false,
    detail: "Assertion evaluated false",
  };
  assert.equal(isFatalOutcome(entry), true);
});

test("REGRESSION: a hard failure still marks the session failed and reports it", async () => {
  const record = await startSession("regression-hard-assert");
  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_assert",
    ok: false,
    detail: "Assertion evaluated false",
  });
  markFailed(record.id);

  const ended = await endSession(record.id);
  assert.equal(ended!.status, "failed");

  const { jsonPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(json.status, "failed");
});

// --- AC1/AC2: a soft check that evaluates false does not condemn the run ---

test("a soft check that evaluates false is not fatal", () => {
  const entry = {
    timestamp: new Date().toISOString(),
    action: "ui_check",
    ok: false,
    detail: "Check evaluated false",
    soft: true,
  };
  assert.equal(isFatalOutcome(entry), false);
});

test("a session whose only failure is a soft check ends passed, with the check still visible", async () => {
  const record = await startSession("soft-check-only");
  logAction(record.id, { timestamp: new Date().toISOString(), action: "ui_navigate", ok: true });
  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_check",
    ok: false,
    detail: "Check evaluated false",
    soft: true,
  });

  const ended = await endSession(record.id);
  assert.equal(ended!.status, "passed");
  assert.equal(ended!.failureScreenshot, undefined);

  const { jsonPath, htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  const json = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(json.status, "passed");

  // Recorded, not swallowed — hiding a soft failure is the opposite failure mode.
  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /ui_check/);
  assert.match(html, /CHECK/);
  assert.match(html, /1 non-fatal check\(s\) false/);
});

// The tests above hand-build the LoggedAction. These cover the step that actually
// decides `soft` from an assertCondition result — without them, inverting that
// decision in server.ts would leave the whole suite green.

test("a condition that ran and came back falsy is classified soft, and is not fatal", () => {
  const outcome = classifyCheckOutcome({ ok: true, passed: false });
  assert.equal(outcome.soft, true);
  assert.equal(outcome.ok, false);
  assert.equal(
    isFatalOutcome({ timestamp: "t", action: "ui_check", ok: outcome.ok, soft: outcome.soft }),
    false
  );
});

test("a condition that held is classified as a plain pass, not a soft check", () => {
  const outcome = classifyCheckOutcome({ ok: true, passed: true });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.soft, false);
});

test("a condition that could not run is classified hard, and IS fatal", () => {
  const outcome = classifyCheckOutcome({ ok: false, error: "No active page — call ui_navigate first" });
  assert.equal(outcome.soft, false);
  assert.equal(outcome.detail, "No active page — call ui_navigate first");
  assert.equal(
    isFatalOutcome({ timestamp: "t", action: "ui_check", ok: outcome.ok, soft: outcome.soft }),
    true
  );
});

// --- AC3: a check that cannot run is a harness error, and stays hard ---

test("an outcome that could not run is fatal even though ui_check is the caller", () => {
  const entry = {
    timestamp: new Date().toISOString(),
    action: "ui_check",
    ok: false,
    detail: "No active page — call ui_navigate first",
  };
  assert.equal(isFatalOutcome(entry), true);
});

// --- AC5/AC6: ui_wait_for ---

test("ui_wait_for returns as soon as the condition holds, recording one outcome", async () => {
  const record = await startSession("wait-for-success");
  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body></body></html>");
  // Condition becomes true ~150ms in.
  await page.evaluate("setTimeout(() => { window.__ready = true; }, 150)");

  const result = await waitForCondition(page, "window.__ready === true", 5000);
  assert.equal(result.ok, true);
  assert.ok(result.elapsedMs! >= 100, "should have waited for the condition");
  assert.ok(result.elapsedMs! < 5000, "should return early, not burn the timeout");

  await endSession(record.id);
});

test("ui_wait_for that never satisfies fails hard after the timeout", async () => {
  const record = await startSession("wait-for-timeout");
  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body></body></html>");

  const result = await waitForCondition(page, "window.__never === true", 300);
  assert.equal(result.ok, false);
  assert.match(result.error!, /Timed out after \d+ms/);
  assert.ok(result.elapsedMs! >= 300);

  // A timeout is a real failure — it must be fatal, unlike a soft check.
  assert.equal(
    isFatalOutcome({ timestamp: new Date().toISOString(), action: "ui_wait_for", ok: false }),
    true
  );

  await endSession(record.id);
});

test("ui_wait_for fails immediately when the expression throws, rather than retrying it", async () => {
  const record = await startSession("wait-for-throws");
  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body></body></html>");

  const startedAt = Date.now();
  const result = await waitForCondition(page, "nope.not.a.thing", 5000);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.ok, false);
  assert.ok(elapsed < 2000, `should fail fast, took ${elapsed}ms`);

  await endSession(record.id);
});

test("ui_wait_for rejects a non-positive timeout instead of spinning", async () => {
  const record = await startSession("wait-for-zero");
  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body></body></html>");

  const result = await waitForCondition(page, "true", 0);
  assert.equal(result.ok, false);
  assert.match(result.error!, /positive/);

  await endSession(record.id);
});

test("ui_wait_for with no active page is a clear error, not a crash", async () => {
  const result = await waitForCondition(undefined, "true", 1000);
  assert.equal(result.ok, false);
  assert.match(result.error!, /No active page/);
});

// --- AC8: failure-screenshot budget ---

test("failure screenshots are budgeted per session and the record says when the cap is hit", async () => {
  const record = await startSession("screenshot-budget");

  assert.equal(claimFailureScreenshot(record.id, 2), true);
  assert.equal(claimFailureScreenshot(record.id, 2), true);
  assert.equal(claimFailureScreenshot(record.id, 2), false, "third claim is over budget");

  const ended = await endSession(record.id);
  assert.equal(ended!.failureScreenshotCount, 2);
  assert.equal(ended!.screenshotBudgetReached, true);

  const { htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  assert.match(readFileSync(htmlPath, "utf8"), /Screenshot budget reached/);
});

test("claiming a screenshot for an unknown session is false, not a crash", () => {
  assert.equal(claimFailureScreenshot("does-not-exist"), false);
});

// --- AC7: identical screenshots are embedded once ---

test("two actions referencing identical screenshot content embed the image only once", async () => {
  const record = await startSession("screenshot-dedupe");
  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body>dedupe</body></html>");

  await mkdirSync(TMP_REPORTS_DIR, { recursive: true });
  const shotA = path.join(TMP_REPORTS_DIR, "dedupe-a.png");
  const shotB = path.join(TMP_REPORTS_DIR, "dedupe-b.png");
  await page.screenshot({ path: shotA });
  copyFileSync(shotA, shotB); // same bytes, different path

  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_take_screenshot",
    args: { path: shotA },
    ok: true,
  });
  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_take_screenshot",
    args: { path: shotB },
    ok: true,
  });

  const ended = await endSession(record.id);
  const { htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  const html = readFileSync(htmlPath, "utf8");

  const embedded = html.match(/data:image\/png;base64,/g) ?? [];
  assert.equal(embedded.length, 1, "identical bytes should be embedded exactly once");
  // ...but both rows still show it.
  const references = html.match(/class="shot shot-[0-9a-f]{12}"/g) ?? [];
  assert.equal(references.length, 2);
});

// ---------------------------------------------------------------------------
// T014 — step attribution and browser-problem capture
// ---------------------------------------------------------------------------

test("setCurrentStep stamps subsequent actions, and unset means no step", async () => {
  const record = await startSession("step-attribution");
  assert.equal(getCurrentStep(record.id), undefined);

  logAction(record.id, { timestamp: new Date().toISOString(), action: "ui_navigate", ok: true });
  setCurrentStep(record.id, "Log in");
  assert.equal(getCurrentStep(record.id), "Log in");
  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_fill",
    ok: true,
    step: getCurrentStep(record.id),
  });

  const ended = await endSession(record.id);
  assert.equal(ended!.actions[0].step, undefined, "pre-step action keeps no label");
  assert.equal(ended!.actions[1].step, "Log in");
});

test("setCurrentStep on an unknown session is a no-op, not a crash", () => {
  setCurrentStep("does-not-exist", "nope");
  assert.equal(getCurrentStep("does-not-exist"), undefined);
});

test("console errors and failed requests are captured without failing the session", async () => {
  const record = await startSession("issue-capture");
  const page = getSessionPage(record.id)!;
  await page.setContent(`<html><body><script>
    console.error("boom from the page");
    fetch("http://127.0.0.1:1/never").catch(() => {});
  </script></body></html>`);
  // Give the listeners a moment to fire.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const ended = await endSession(record.id);
  assert.equal(ended!.status, "passed", "browser problems must not change the verdict");

  const kinds = (ended!.issues ?? []).map((i) => i.kind);
  assert.ok(kinds.includes("console"), `expected a console issue, got ${JSON.stringify(ended!.issues)}`);
  assert.ok(
    (ended!.issues ?? []).some((i) => i.text.includes("boom from the page")),
    "console message text should be retained"
  );

  const { htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  assert.match(readFileSync(htmlPath, "utf8"), /boom from the page/);
});

test("uncaught page errors are captured as pageerror issues", async () => {
  const record = await startSession("pageerror-capture");
  const page = getSessionPage(record.id)!;
  await page.setContent(`<html><body><script>setTimeout(() => { throw new Error("uncaught kaboom"); }, 0);</script></body></html>`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const ended = await endSession(record.id);
  assert.equal(ended!.status, "passed");
  assert.ok(
    (ended!.issues ?? []).some((i) => i.kind === "pageerror" && i.text.includes("uncaught kaboom")),
    `expected a pageerror issue, got ${JSON.stringify(ended!.issues)}`
  );
});

test("retained issues are capped and the record says they were truncated", async () => {
  const record = await startSession("issue-cap");
  const page = getSessionPage(record.id)!;
  await page.setContent(`<html><body><script>
    for (let i = 0; i < ${MAX_PAGE_ISSUES + 20}; i++) console.error("spam " + i);
  </script></body></html>`);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const ended = await endSession(record.id);
  assert.equal(ended!.issues!.length, MAX_PAGE_ISSUES, "must stop retaining past the cap");
  assert.equal(ended!.issuesTruncated, true);

  const { htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  assert.match(readFileSync(htmlPath, "utf8"), /later ones were dropped/);
});

test("a session with no browser problems has no issues section", async () => {
  const record = await startSession("no-issues");
  const page = getSessionPage(record.id)!;
  await page.setContent("<html><body>quiet</body></html>");

  const ended = await endSession(record.id);
  assert.deepEqual(ended!.issues, []);

  const { htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  assert.doesNotMatch(readFileSync(htmlPath, "utf8"), /Browser problems/);
});

test("a missing screenshot file is omitted rather than failing the report", async () => {
  const record = await startSession("screenshot-missing");
  logAction(record.id, {
    timestamp: new Date().toISOString(),
    action: "ui_take_screenshot",
    args: { path: path.join(TMP_REPORTS_DIR, "does-not-exist.png") },
    ok: true,
  });

  const ended = await endSession(record.id);
  const { htmlPath } = await writeReports(ended!, TMP_REPORTS_DIR);
  assert.ok(existsSync(htmlPath));
  assert.doesNotMatch(readFileSync(htmlPath, "utf8"), /data:image\/png/);
});

// ---------------------------------------------------------------------------
// T033 — debug logs, HTTP errors, tabs, downloads
// ---------------------------------------------------------------------------

/** Local fixture server on an OS-assigned port, torn down after `fn` (T022 teardown rule). */
async function withFixture(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Notices are drained by takeNotices; collect them across polls. */
function noticeCollector(id: string): { all: string[]; poll: () => string[] } {
  const all: string[] = [];
  return { all, poll: () => (all.push(...takeNotices(id)), all) };
}

const POPUP_SITE = (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/api/data?token=secret") {
    res.statusCode = 500;
    res.end("boom");
  } else if (req.url === "/popup") {
    res.end("<title>Popup page</title><p id='in-popup'>in popup</p>");
  } else {
    res.end(`<title>Opener</title><a id="l" target="_blank" href="/popup">open</a>
      <script>fetch("/api/data?token=secret"); console.error("render failed");</script>`);
  }
};

test("AC1/AC2: an HTTP 500 is captured as an httperror (query stripped) and ui_get_logs reads it mid-flow", async () => {
  await withFixture(POPUP_SITE, async (base) => {
    const record = await startSession("http-errors");
    const page = getSessionPage(record.id)!;
    await page.goto(base);
    // Polling with since:"start" also moves the `last` cursor, so keep the final poll as the read under test.
    let first = getSessionLogs(record.id, { since: "start" });
    await until(() => ((first = getSessionLogs(record.id, { since: "start" })).lines?.length ?? 0) >= 2);
    assert.equal(first.ok, true);
    const text = first.lines!.join("\n");
    assert.match(text, /render failed/);
    assert.match(text, /500 GET http:\/\/127\.0\.0\.1:\d+\/api\/data/);
    assert.doesNotMatch(text, /secret/, "query strings may hold tokens and must not be logged");

    const second = getSessionLogs(record.id, {});
    assert.deepEqual(second.lines, [], "`last` returns only issues since the previous call");
    const again = getSessionLogs(record.id, { since: "start" });
    assert.equal(again.lines!.length, first.lines!.length, "`start` returns everything");

    const ended = await endSession(record.id);
    assert.equal(ended!.status, "passed", "an HTTP error never fails the session");
    assert.ok(ended!.issues!.some((i) => i.kind === "httperror" && i.text.startsWith("500 GET ")));
  });
});

test("AC2: ui_get_logs groups repeats, caps at 50 lines with a note, and gates warnings on level", async () => {
  const record = await startSession("log-shape");
  const page = getSessionPage(record.id)!;
  await page.setContent(`<script>
    for (let i = 0; i < 3; i++) console.error("favicon missing");
    console.warn("deprecated api");
  </script>`);
  await until(() => (getSessionLogs(record.id, { since: "start" }).lines?.length ?? 0) >= 1);

  const errors = getSessionLogs(record.id, { since: "start" });
  assert.deepEqual(errors.lines, ["console: favicon missing ×3"]);

  // The errors call did not read the warnings, so a later level:"warning" call still gets them.
  const unread = getSessionLogs(record.id, { level: "warning" });
  assert.deepEqual(unread.lines, ["warning: deprecated api"]);
  const everything = getSessionLogs(record.id, { since: "start", level: "warning" });
  assert.equal(everything.lines!.length, 2);
  await endSession(record.id);
});

test("AC2: ui_get_logs output is capped at 50 lines with a truncation note", async () => {
  const record = await startSession("log-cap");
  const page = getSessionPage(record.id)!;
  await page.setContent(`<script>
    for (let i = 0; i < ${MAX_PAGE_ISSUES + 10}; i++) console.error("distinct " + i);
    for (let i = 0; i < 5; i++) console.warn("warn " + i);
  </script>`);
  await until(() => getSessionLogs(record.id, { since: "start", level: "warning" }).lines!.length >= 50);
  const capped = getSessionLogs(record.id, { since: "start", level: "warning" });
  assert.equal(capped.lines!.length, 50);
  assert.match(capped.note ?? "", /truncated/i);
  await endSession(record.id);
});

test("ui_get_logs on an unknown session is an error, not a crash", () => {
  assert.equal(getSessionLogs("does-not-exist", {}).ok, false);
});

test("AC3/AC4: a _blank popup is announced once, listed, switchable and closable", async () => {
  await withFixture(POPUP_SITE, async (base) => {
    const record = await startSession("tabs");
    const notices = noticeCollector(record.id);
    const first = getSessionPage(record.id)!;
    await first.goto(base);
    assert.deepEqual(takeNotices(record.id), []);
    await first.click("#l");
    await until(() => notices.poll().length > 0);
    assert.deepEqual(notices.all, [`New tab opened: ${base}/popup (tab 2)`]);
    assert.deepEqual(takeNotices(record.id), [], "a notice is delivered once");

    const tabs = await listTabs(record.id);
    assert.deepEqual(
      tabs!.map((t) => [t.index, t.current]),
      [[1, true], [2, false]]
    );
    assert.equal(tabs![1].url, `${base}/popup`);
    assert.equal(tabs![1].title, "Popup page");

    assert.equal((await switchTab(record.id, 2)).ok, true);
    assert.equal(await getSessionPage(record.id)!.locator("#in-popup").count(), 1);
    assert.equal((await listTabs(record.id))![1].current, true);

    assert.equal((await switchTab(record.id, 3)).ok, false);
    assert.equal((await switchTab(record.id, 0)).ok, false);

    assert.equal((await closeTab(record.id, 2)).ok, true);
    assert.equal(getSessionPage(record.id), first, "closing the current tab falls back to the previous tab");
    assert.equal((await listTabs(record.id))!.length, 1);

    const last = await closeTab(record.id, 1);
    assert.equal(last.ok, false, "closing the last tab is an error");
    assert.equal((await listTabs(record.id))!.length, 1);
    await endSession(record.id);
  });
});

test("AC5: later tabs feed the same issue list, and ending the session closes every tab", async () => {
  await withFixture(
    (req, res) => {
      res.setHeader("content-type", "text/html");
      if (req.url === "/popup") res.end(`<script>console.error("popup broke")</script>`);
      else res.end(`<a id="l" target="_blank" href="/popup">open</a>`);
    },
    async (base) => {
      const record = await startSession("tab-issues");
      const page = getSessionPage(record.id)!;
      await page.goto(base);
      await page.click("#l");
      await until(() => getSessionLogs(record.id, { since: "start" }).lines!.some((l) => l.includes("popup broke")));
      const context = page.context();
      assert.equal(context.pages().length, 2);
      await endSession(record.id);
      assert.equal(context.pages().length, 0, "ui_end_session closes all tabs");
    }
  );
});

test("a popup that closes itself is announced and the current tab stays the opener", async () => {
  await withFixture(
    (req, res) => {
      res.setHeader("content-type", "text/html");
      if (req.url === "/popup") res.end(`<script>window.close()</script>`);
      else res.end(`<a id="l" target="_blank" href="/popup">open</a>`);
    },
    async (base) => {
      const record = await startSession("self-closing-popup");
      const notices = noticeCollector(record.id);
      const page = getSessionPage(record.id)!;
      await page.goto(base);
      await page.click("#l");
      await until(() => notices.poll().some((n) => /closed/i.test(n)));
      assert.equal((await listTabs(record.id))!.length, 1);
      assert.equal(getSessionPage(record.id), page);
      await endSession(record.id);
    }
  );
});

test("AC8: a download is saved under reports/downloads/<session>/, logged as an action and announced", async () => {
  await withFixture(
    (req, res) => {
      if (req.url === "/export.csv") {
        res.setHeader("content-type", "text/csv");
        res.setHeader("content-disposition", 'attachment; filename="../export.csv"');
        res.end("a,b\n1,2\n");
      } else {
        res.setHeader("content-type", "text/html");
        res.end(`<a id="d" href="/export.csv" download>Export</a>`);
      }
    },
    async (base) => {
      const record = await startSession("downloads", undefined, TMP_REPORTS_DIR);
      const notices = noticeCollector(record.id);
      const page = getSessionPage(record.id)!;
      await page.goto(base);
      await page.click("#d");
      await until(() => notices.poll().some((n) => n.startsWith("Downloaded:")));
      // Chromium already neutralises the "../" in the suggested name; safeFileName is the backstop.
      assert.match(notices.all.join("\n"), /Downloaded: [\w-]*export\.csv \(8 bytes\)/);
      assert.doesNotMatch(notices.all.join("\n"), /\.\.\//);

      const ended = await endSession(record.id);
      const action = ended!.actions.find((a) => a.action === "ui_download");
      assert.ok(action, "download logged as an action");
      assert.equal(action!.ok, true);
      assert.equal(action!.args!.size, 8);
      const dir = path.join(TMP_REPORTS_DIR, "downloads", record.id);
      const files = readdirSync(dir);
      assert.equal(files.length, 1);
      assert.match(files[0], /export\.csv$/);
      assert.ok(!files[0].includes(".."), "path traversal in the suggested name is stripped");
      assert.equal(ended!.status, "passed");
    }
  );
});

test("closing the current tab from the page falls back to the previous tab with a notice", async () => {
  await withFixture(POPUP_SITE, async (base) => {
    const record = await startSession("current-tab-closes");
    const notices = noticeCollector(record.id);
    const first = getSessionPage(record.id)!;
    await first.goto(base);
    await first.click("#l");
    await until(() => notices.poll().length > 0);
    await switchTab(record.id, 2);
    await getSessionPage(record.id)!.evaluate("window.close()");
    await until(() => notices.poll().some((n) => /now on tab 1/.test(n)));
    assert.equal(getSessionPage(record.id), first);
    await endSession(record.id);
  });
});
