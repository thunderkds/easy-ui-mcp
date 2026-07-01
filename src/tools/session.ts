// Session lifecycle: brackets a test run between ui_start_session/ui_end_session.
// T003 — see tasks/TASK_GUIDE_T003.md.
//
// Each session owns a fresh Playwright browser + browser context (its own page),
// so concurrent sessions cannot corrupt or merge each other's browser state
// (Acceptance Criterion 5). Sessions are keyed by a random session id, independent
// of the MCP transport session — a single MCP connection is expected to have at
// most one active ui_session at a time, but the registry itself supports many.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";

export interface LoggedAction {
  timestamp: string;
  action: string;
  args?: Record<string, unknown>;
  ok: boolean;
  detail?: string;
}

export type SessionStatus = "running" | "passed" | "failed";

export interface SessionRecord {
  id: string;
  target: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  actions: LoggedAction[];
  failureScreenshot?: string;
}

interface Session extends SessionRecord {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS ?? 10 * 60 * 1000);

const sessions = new Map<string, Session>();

/**
 * Start a new session: launches a fresh browser + context + page, isolated
 * from any other session. Schedules an auto-cleanup timeout so a session
 * left open with no `ui_end_session()` call does not leak the browser
 * process indefinitely (Acceptance Criterion 6).
 */
export async function startSession(
  target: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<SessionRecord> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
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
    browser,
    context,
    page,
    timeoutHandle,
  };
  sessions.set(id, session);
  return toRecord(session);
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
  const { browser: _b, context: _c, page: _p, timeoutHandle: _t, ...record } = session;
  return { ...record, actions: [...record.actions] };
}
