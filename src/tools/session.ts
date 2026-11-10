// Session lifecycle: brackets a test run between ui_start_session/ui_end_session.
// T003 — see tasks/TASK_GUIDE_T003.md.
//
// Each session owns a fresh Playwright browser + browser context (its own page),
// so concurrent sessions cannot corrupt or merge each other's browser state
// (Acceptance Criterion 5). Sessions are keyed by a random session id, independent
// of the MCP transport session — a single MCP connection is expected to have at
// most one active ui_session at a time, but the registry itself supports many.

import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
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

export type SessionStatus = "running" | "passed" | "failed";

/** Browser-context settings a session can start with (T032/FR-024). All optional;
 * with none, the context is Playwright's default (1280x720, desktop). */
export interface SessionSettings {
  /** A Playwright `devices` name, e.g. "iPhone 13": sets viewport, user agent, scale factor, mobile, touch. */
  device?: string;
  /** Explicit size; overrides the device's own viewport. */
  viewport?: { width: number; height: number };
  colorScheme?: "light" | "dark";
  locale?: string;
  timezoneId?: string;
}

/**
 * Playwright `newContext` options for `settings`, or an error naming valid device
 * names when `device` is unknown. Pure, so the merge rules are unit-testable.
 */
export function resolveContextOptions(
  settings: SessionSettings = {}
): { ok: true; options: Parameters<Browser["newContext"]>[0] } | { ok: false; error: string } {
  const { device, viewport, colorScheme, locale, timezoneId } = settings;
  let base = {};
  if (device !== undefined) {
    const known = devices[device];
    if (!known) {
      const names = Object.keys(devices);
      const needle = device.toLowerCase();
      const close = names.filter((n) => n.toLowerCase().includes(needle));
      const fallback = ["iPhone 13", "Pixel 7", "iPad Pro 11", "Galaxy S9+"].filter((n) => n in devices);
      const sample = (close.length > 0 ? close : fallback).slice(0, 5);
      return {
        ok: false,
        error: `Unknown device "${device}". Valid names include: ${sample.map((n) => `"${n}"`).join(", ")} (${names.length} in total)`,
      };
    }
    base = known;
  }
  return {
    ok: true,
    options: {
      ...base,
      ...(viewport && { viewport }),
      ...(colorScheme && { colorScheme }),
      ...(locale && { locale }),
      ...(timezoneId && { timezoneId }),
    },
  };
}

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
  /** Context settings the session started with; absent when none were given. */
  settings?: SessionSettings;
}

interface Session extends SessionRecord {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** Label set by the most recent ui_step; stamped onto subsequent actions. */
  currentStep?: string;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS ?? 10 * 60 * 1000);

/** Max auto-failure screenshots per session. Beyond this the run keeps going but
 * stops writing PNGs, and the report records that captures were dropped. */
export const DEFAULT_FAILURE_SCREENSHOT_BUDGET = Number(process.env.FAILURE_SCREENSHOT_BUDGET ?? 3);

const sessions = new Map<string, Session>();

/**
 * Start a new session: launches a fresh browser + context + page, isolated
 * from any other session. Schedules an auto-cleanup timeout so a session
 * left open with no `ui_end_session()` call does not leak the browser
 * process indefinitely (Acceptance Criterion 6).
 */
export async function startSession(
  target: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  settings?: SessionSettings
): Promise<SessionRecord> {
  const resolved = resolveContextOptions(settings);
  if (!resolved.ok) throw new Error(resolved.error);
  const browser = await chromium.launch({ headless: true });
  let context: BrowserContext;
  let page: Page;
  try {
    context = await browser.newContext(resolved.options);
    page = await context.newPage();
  } catch (err) {
    // e.g. an invalid locale or timezone id: do not leak the browser process.
    await browser.close().catch(() => undefined);
    throw err;
  }
  const id = randomUUID();

  const timeoutHandle = setTimeout(() => {
    void cleanupTimedOutSession(id);
  }, timeoutMs);
  // Don't let this timer keep the process alive on its own.
  timeoutHandle.unref?.();

  const session: Session = {
    id,
    target,
    status: "running",
    startedAt: new Date().toISOString(),
    actions: [],
    issues: [],
    ...(settings && Object.keys(settings).length > 0 && { settings: { ...settings } }),
    browser,
    context,
    page,
    timeoutHandle,
  };
  sessions.set(id, session);
  attachIssueListeners(session);
  return toRecord(session);
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

async function cleanupTimedOutSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
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
    currentStep: _s,
    ...record
  } = session;
  return { ...record, actions: [...record.actions], issues: [...(record.issues ?? [])] };
}
