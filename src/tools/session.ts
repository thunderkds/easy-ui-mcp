// Session lifecycle: brackets a test run between ui_start_session/ui_end_session.
// T003 — see tasks/TASK_GUIDE_T003.md.
//
// Each session owns a fresh Playwright browser + browser context (its own page),
// so concurrent sessions cannot corrupt or merge each other's browser state
// (Acceptance Criterion 5). Sessions are keyed by a random session id, independent
// of the MCP transport session. One MCP connection may hold several (T029); which
// connection owns which id is tracked in connection-sessions.ts, not here.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";

export interface LoggedAction {
  timestamp: string;
  action: string;
  args?: Record<string, unknown>;
  ok: boolean;
  detail?: string;
  /**
   * A soft outcome: recorded and shown, but never condemns the session (T013/FR-014).
   * Only meaningful when `ok` is false — a soft check that *ran* and evaluated falsy.
   * A check that could not run at all (no page, expression threw) is a harness error
   * and stays hard, so `soft` is not set for it.
   */
  soft?: boolean;
  /** Caller-supplied intent label this action belongs to (T014/FR-016). Absent for
   * actions recorded before the first ui_step. */
  step?: string;
}

/** A browser-side problem observed during the session. Surfaced in the report but
 * never changes session status (T014/FR-018) — a console error is information, and
 * failing the run on one would re-create the false-verdict problem T013 fixed. */
export interface PageIssue {
  timestamp: string;
  kind: "console" | "pageerror" | "requestfailed";
  text: string;
}

/** Cap on retained page issues. An app in a redirect loop can emit thousands, and
 * the report must not become the 300 KB artifact T013 just shrank. */
export const MAX_PAGE_ISSUES = 50;

/**
 * True when an outcome should fail the session. A soft outcome never does;
 * everything else follows the original rule (any `ok: false` fails the run).
 *
 * Extracted so the semantics are unit-testable — `recordAction` itself lives
 * inside a per-connection closure in server.ts and cannot be called directly.
 */
export function isFatalOutcome(entry: LoggedAction): boolean {
  return entry.ok === false && entry.soft !== true;
}

/** `timed_out`: closed by the idle timer, not by ui_end_session (T029/D5). */
export type SessionStatus = "running" | "passed" | "failed" | "timed_out";

export interface SessionRecord {
  id: string;
  target: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  actions: LoggedAction[];
  failureScreenshot?: string;
  /** Auto-failure screenshots taken so far, against DEFAULT_FAILURE_SCREENSHOT_BUDGET. */
  failureScreenshotCount?: number;
  /** Set once the budget is exhausted, so the report can say captures were dropped
   * rather than silently omitting them (NFR-008). */
  screenshotBudgetReached?: boolean;
  /** Console errors, uncaught page errors, and failed requests seen during the run. */
  issues?: PageIssue[];
  /** Set once MAX_PAGE_ISSUES is hit, so the report says issues were dropped. */
  issuesTruncated?: boolean;
}

interface Session extends SessionRecord {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Idle timer: re-armed whenever the last in-flight call ends (T029). */
  timeoutHandle?: ReturnType<typeof setTimeout>;
  idleMs: number;
  onIdle?: IdleCallback;
  /** Tool calls running right now; the idle timer never closes a session while > 0. */
  inFlight: number;
  /** Label set by the most recent ui_step; stamped onto subsequent actions. */
  currentStep?: string;
}

/** Handed the final record of a session the idle timer just closed. Must not be relied
 * on to succeed: a throw or rejection is logged and swallowed. */
export type IdleCallback = (record: SessionRecord) => void | Promise<void>;

/** How long a session may sit with no tool call before it is closed (T029/D4). */
export const DEFAULT_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS ?? 10 * 60 * 1000);

/** Max auto-failure screenshots per session. Beyond this the run keeps going but
 * stops writing PNGs, and the report records that captures were dropped. */
export const DEFAULT_FAILURE_SCREENSHOT_BUDGET = Number(process.env.FAILURE_SCREENSHOT_BUDGET ?? 3);

const sessions = new Map<string, Session>();

/**
 * Start a new session: launches a fresh browser + context + page, isolated
 * from any other session. The session is closed if it sits idle for `timeoutMs`
 * (measured from the last tool call, see beginCall/endCall), so one left open
 * with no `ui_end_session()` call does not leak the browser process
 * (Acceptance Criterion 6). When `onIdle` is given it receives the final record
 * so the caller can still write the report; without it the session is just closed.
 */
export async function startSession(
  target: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  onIdle?: IdleCallback
): Promise<SessionRecord> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const id = randomUUID();

  const session: Session = {
    id,
    target,
    status: "running",
    startedAt: new Date().toISOString(),
    actions: [],
    issues: [],
    browser,
    context,
    page,
    idleMs: timeoutMs,
    onIdle,
    inFlight: 0,
  };
  armIdleTimer(session);
  sessions.set(id, session);
  attachIssueListeners(session);
  return toRecord(session);
}

function armIdleTimer(session: Session): void {
  clearTimeout(session.timeoutHandle);
  session.timeoutHandle = setTimeout(() => {
    void closeIdleSession(session.id);
  }, session.idleMs);
  // Don't let this timer keep the process alive on its own.
  session.timeoutHandle.unref?.();
}

/** A tool call is starting on this session: stop the idle clock until it ends. */
export function beginCall(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.inFlight++;
  clearTimeout(session.timeoutHandle);
}

/** A tool call finished: when none are left running, idle time counts from now. */
export function endCall(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.inFlight = Math.max(0, session.inFlight - 1);
  if (session.inFlight === 0) armIdleTimer(session);
}

/** "10 min" / "1.5 min" / "0.5 s": the idle limit as a person would say it. */
export function formatIdle(ms: number): string {
  return ms >= 60_000 ? `${Number((ms / 60_000).toFixed(1))} min` : `${Number((ms / 1000).toFixed(1))} s`;
}

/**
 * Watch the page for browser-side problems a passing flow would otherwise hide:
 * console errors, uncaught exceptions, and failed requests. These are recorded
 * for the report only — they never touch session status (FR-018).
 */
function attachIssueListeners(session: Session): void {
  const record = (kind: PageIssue["kind"], text: string) => {
    const issues = session.issues;
    if (!issues) return;
    if (issues.length >= MAX_PAGE_ISSUES) {
      session.issuesTruncated = true;
      return;
    }
    issues.push({ timestamp: new Date().toISOString(), kind, text });
  };

  session.page.on("console", (msg) => {
    if (msg.type() === "error") record("console", msg.text());
  });
  session.page.on("pageerror", (err) => record("pageerror", err.message));
  session.page.on("requestfailed", (req) => {
    const reason = req.failure()?.errorText ?? "request failed";
    record("requestfailed", `${req.method()} ${req.url()} — ${reason}`);
  });
}

/** Set the intent label subsequent actions belong to (FR-016). */
export function setCurrentStep(id: string, label: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.currentStep = label;
}

/** The label to stamp on the next recorded action, if any. */
export function getCurrentStep(id: string): string | undefined {
  return sessions.get(id)?.currentStep;
}

/**
 * The idle timer fired. Leaving the registry is synchronous, so a racing
 * `endSession` and this path cannot both take the session: whichever deletes first
 * owns the record. The browser is closed even if `onIdle` fails.
 */
async function closeIdleSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.inFlight > 0) return;
  sessions.delete(id);
  session.status = "timed_out";
  session.endedAt = new Date().toISOString();
  session.actions.push({
    timestamp: session.endedAt,
    action: "session_idle_timeout",
    ok: true,
    detail: `Closed after ${formatIdle(session.idleMs)} idle`,
  });
  const closing = closeBrowser(session);
  try {
    await session.onIdle?.(toRecord(session));
  } catch (err) {
    console.error(`[session ${id}] idle cleanup failed:`, err);
  }
  await closing;
}

async function closeBrowser(session: Session): Promise<void> {
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
}

/** Returns the live Playwright page for a session, or undefined if unknown/ended. */
export function getSessionPage(id: string): Page | undefined {
  return sessions.get(id)?.page;
}

export function isSessionActive(id: string): boolean {
  return sessions.has(id);
}

/** Append a logged action to the session's in-memory action list. */
export function logAction(id: string, action: LoggedAction): void {
  sessions.get(id)?.actions.push(action);
}

/**
 * Reserve one auto-failure screenshot against the session's budget. Returns false
 * once the budget is spent, and flags the record so the report can say so.
 */
export function claimFailureScreenshot(
  id: string,
  budget: number = DEFAULT_FAILURE_SCREENSHOT_BUDGET
): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  const taken = session.failureScreenshotCount ?? 0;
  if (taken >= budget) {
    session.screenshotBudgetReached = true;
    return false;
  }
  session.failureScreenshotCount = taken + 1;
  return true;
}

/** Mark a session failed (first failing step wins — status only moves running -> failed). */
export function markFailed(id: string, failureScreenshot?: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.status = "failed";
  if (failureScreenshot) session.failureScreenshot = failureScreenshot;
}

/**
 * End a session: closes its browser resources, cancels the timeout, and
 * returns the final record (status defaults to "passed" unless a step
 * already marked it "failed").
 */
export async function endSession(id: string): Promise<SessionRecord | undefined> {
  const session = sessions.get(id);
  if (!session) return undefined;
  sessions.delete(id);
  clearTimeout(session.timeoutHandle);
  if (session.status === "running") session.status = "passed";
  session.endedAt = new Date().toISOString();
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
  return toRecord(session);
}

function toRecord(session: Session): SessionRecord {
  const {
    browser: _b,
    context: _c,
    page: _p,
    timeoutHandle: _t,
    idleMs: _i,
    onIdle: _o,
    inFlight: _f,
    currentStep: _s,
    ...record
  } = session;
  return { ...record, actions: [...record.actions], issues: [...(record.issues ?? [])] };
}
