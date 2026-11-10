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
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

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
  kind: "console" | "pageerror" | "requestfailed" | "httperror";
  text: string;
}

/** Cap on retained page issues. An app in a redirect loop can emit thousands, and
 * the report must not become the 300 KB artifact T013 just shrank. */
export const MAX_PAGE_ISSUES = 50;

/** Cap on lines one ui_get_logs call returns (T033). */
export const MAX_LOG_LINES = 50;

/** Downloads are saved to `<reports dir>/downloads/<session id>/`. */
const DEFAULT_REPORTS_DIR = path.join(process.cwd(), "reports");

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
  /** The current tab: the page every tool acts on (T033). */
  page: Page;
  /** Every open tab in opening order; tab numbers shown to the agent are 1-based. */
  tabs: Page[];
  reportsDir: string;
  /** One-shot messages ("New tab opened", "Downloaded") appended to the next tool response. */
  notices: string[];
  /** Console warnings: readable via ui_get_logs(level: "warning") only, never in the report. */
  warnings: PageIssue[];
  /** How much of issues/warnings ui_get_logs has already returned. */
  logCursor: { issues: number; warnings: number };
  downloadCount: number;
  downloadNames: Set<string>;
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
  reportsDir: string = DEFAULT_REPORTS_DIR
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
    issues: [],
    browser,
    context,
    page,
    tabs: [page],
    reportsDir,
    notices: [],
    warnings: [],
    logCursor: { issues: 0, warnings: 0 },
    downloadCount: 0,
    downloadNames: new Set(),
    timeoutHandle,
  };
  sessions.set(id, session);
  trackPage(session, page);
  // target=_blank links and window.open: the new tab is tracked but not switched to.
  context.on("page", (opened) => {
    session.tabs.push(opened);
    trackPage(session, opened);
    session.notices.push(`New tab opened: ${redactUrl(opened.url())} (tab ${session.tabs.length})`);
  });
  return toRecord(session);
}

/** A URL safe to log: the query string and fragment may hold tokens, so they are dropped. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
    }
  } catch {
    // not a URL: fall through to the plain truncation below
  }
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}

/** Everything that must hold for every tab the session owns. */
function trackPage(session: Session, page: Page): void {
  attachIssueListeners(session, page);
  page.on("download", (download) => void saveDownload(session, download));
  page.on("close", () => onTabClosed(session, page));
}

/** A tab closed by the page itself (an OAuth popup finishing). `closeTab` removes its tab first, so it never lands here. */
function onTabClosed(session: Session, page: Page): void {
  if (!sessions.has(session.id)) return;
  const i = session.tabs.indexOf(page);
  if (i < 0) return;
  session.tabs.splice(i, 1);
  let notice = `Tab ${i + 1} closed`;
  if (session.tabs.length === 0) {
    notice += "; no tabs left";
  } else if (session.page === page) {
    session.page = session.tabs[Math.max(0, i - 1)];
    notice += `; now on tab ${session.tabs.indexOf(session.page) + 1}`;
  }
  session.notices.push(notice);
}

/** A file name from the page-suggested one: no directories, no leading dots, no odd characters. */
function safeFileName(suggested: string): string {
  const base = path
    .basename(suggested.replace(/\\/g, "/"))
    .replace(/[^\w.\- ]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
  return base.trim() === "" ? "download" : base;
}

/** Save a download under reports/downloads/<session>/, log it, and announce it on the next response. */
async function saveDownload(
  session: Session,
  download: { suggestedFilename(): string; saveAs(target: string): Promise<void> }
): Promise<void> {
  const n = ++session.downloadCount;
  let name = safeFileName(download.suggestedFilename());
  if (session.downloadNames.has(name)) name = `${n}-${name}`;
  session.downloadNames.add(name);
  const entry = (rest: Pick<LoggedAction, "args" | "ok" | "detail" | "soft">): LoggedAction => ({
    timestamp: new Date().toISOString(),
    action: "ui_download",
    ...(session.currentStep ? { step: session.currentStep } : {}),
    ...rest,
  });
  try {
    const dir = path.join(session.reportsDir, "downloads", session.id);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await download.saveAs(file);
    const { size } = await stat(file);
    if (!sessions.has(session.id)) return;
    session.actions.push(entry({ args: { file: name, size, path: file }, ok: true }));
    session.notices.push(`Downloaded: ${name} (${size} bytes)`);
  } catch (err) {
    if (!sessions.has(session.id)) return;
    const message = err instanceof Error ? err.message : String(err);
    // Soft: a download we could not keep is information, not a verdict on the app.
    session.actions.push(entry({ args: { file: name }, ok: false, detail: message, soft: true }));
    session.notices.push(`Download failed: ${name} — ${message}`);
  }
}

/**
 * Watch a tab for browser-side problems a passing flow would otherwise hide:
 * console errors, uncaught exceptions, failed requests and HTTP >= 400 responses.
 * These are recorded for the report and ui_get_logs — they never touch session
 * status (FR-018). The MAX_PAGE_ISSUES cap is shared by all tabs.
 */
function attachIssueListeners(session: Session, page: Page): void {
  const record = (kind: PageIssue["kind"], text: string) => {
    const issues = session.issues;
    if (!issues) return;
    if (issues.length >= MAX_PAGE_ISSUES) {
      session.issuesTruncated = true;
      return;
    }
    issues.push({ timestamp: new Date().toISOString(), kind, text });
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") record("console", msg.text());
    else if (msg.type() === "warning" && session.warnings.length < MAX_PAGE_ISSUES) {
      session.warnings.push({ timestamp: new Date().toISOString(), kind: "console", text: msg.text() });
    }
  });
  page.on("pageerror", (err) => record("pageerror", err.message));
  page.on("requestfailed", (req) => {
    const reason = req.failure()?.errorText ?? "request failed";
    record("requestfailed", `${req.method()} ${redactUrl(req.url())} — ${reason}`);
  });
  // A 500 is a *successful* request to Playwright, so requestfailed never sees it.
  page.on("response", (res) => {
    if (res.status() >= 400) {
      record("httperror", `${res.status()} ${res.request().method()} ${redactUrl(res.url())}`);
    }
  });
}

export type LogsResult = { ok: true; lines: string[]; note?: string } | { ok: false; error: string };

/**
 * The session's captured browser problems, for ui_get_logs. `since: "last"` (the
 * default) returns only what arrived after the previous call. Repeats are grouped
 * (`×N`) and the output is capped at MAX_LOG_LINES. Bodies and headers are never
 * captured, so they cannot appear here.
 */
export function getSessionLogs(
  id: string,
  opts: { since?: "start" | "last"; level?: "error" | "warning" }
): LogsResult {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "No active session — call ui_start_session first" };
  const withWarnings = opts.level === "warning";
  const from = opts.since === "start" ? { issues: 0, warnings: 0 } : session.logCursor;
  const issues = session.issues ?? [];

  const entries = [
    ...issues.slice(from.issues).map((i) => ({ ts: i.timestamp, label: i.kind, text: i.text })),
    ...(withWarnings
      ? session.warnings.slice(from.warnings).map((w) => ({ ts: w.timestamp, label: "warning", text: w.text }))
      : []),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  session.logCursor.issues = issues.length;
  // Warnings the caller did not ask for stay unread, so a later level:"warning" call still gets them.
  if (withWarnings) session.logCursor.warnings = session.warnings.length;

  const counts = new Map<string, number>();
  for (const { label, text } of entries) {
    const line = `${label}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const all = [...counts].map(([line, n]) => (n > 1 ? `${line} ×${n}` : line));
  const notes: string[] = [];
  if (all.length > MAX_LOG_LINES) {
    notes.push(`Output truncated: showing the first ${MAX_LOG_LINES} of ${all.length} lines.`);
  }
  if (session.issuesTruncated) {
    notes.push(`Capture stopped after ${MAX_PAGE_ISSUES} issues; later ones were dropped.`);
  }
  return { ok: true, lines: all.slice(0, MAX_LOG_LINES), ...(notes.length > 0 ? { note: notes.join(" ") } : {}) };
}

/** Take (and clear) the one-shot notices waiting for the next tool response. */
export function takeNotices(id: string): string[] {
  return sessions.get(id)?.notices.splice(0) ?? [];
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  current: boolean;
}

/** The session's open tabs (numbered from 1), or undefined if the session is unknown. */
export async function listTabs(id: string): Promise<TabInfo[] | undefined> {
  const session = sessions.get(id);
  if (!session) return undefined;
  return Promise.all(
    session.tabs.map(async (tab, i) => ({
      index: i + 1,
      url: tab.url(),
      title: await tab.title().catch(() => ""),
      current: tab === session.page,
    }))
  );
}

export type TabResult = { ok: true; message: string } | { ok: false; error: string };

function tabAt(session: Session, index: number | undefined): Page | string {
  if (index === undefined) return "index is required";
  const tab = Number.isInteger(index) ? session.tabs[index - 1] : undefined;
  return tab ?? `No tab ${index}; ${session.tabs.length} tab(s) open, numbered from 1`;
}

/** Make tab `index` the page every tool acts on. */
export async function switchTab(id: string, index: number | undefined): Promise<TabResult> {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "No active session — call ui_start_session first" };
  const tab = tabAt(session, index);
  if (typeof tab === "string") return { ok: false, error: tab };
  session.page = tab;
  return { ok: true, message: `Switched to tab ${index} (${redactUrl(tab.url())})` };
}

/** Close tab `index` (default: the current one); the current tab falls back to the previous one. */
export async function closeTab(id: string, index: number | undefined): Promise<TabResult> {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "No active session — call ui_start_session first" };
  if (session.tabs.length === 1) return { ok: false, error: "Cannot close the only open tab" };
  const tab = tabAt(session, index ?? session.tabs.indexOf(session.page) + 1);
  if (typeof tab === "string") return { ok: false, error: tab };
  const i = session.tabs.indexOf(tab);
  session.tabs.splice(i, 1);
  if (session.page === tab) session.page = session.tabs[Math.max(0, i - 1)];
  await tab.close().catch(() => undefined);
  return { ok: true, message: `Closed tab ${i + 1}; now on tab ${session.tabs.indexOf(session.page) + 1}` };
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
    tabs: _tabs,
    reportsDir: _rd,
    notices: _n,
    warnings: _w,
    logCursor: _lc,
    downloadCount: _dc,
    downloadNames: _dn,
    timeoutHandle: _t,
    currentStep: _s,
    ...record
  } = session;
  return { ...record, actions: [...record.actions], issues: [...(record.issues ?? [])] };
}
