// Session lifecycle: brackets a test run between ui_start_session/ui_end_session.
// T003 — see tasks/TASK_GUIDE_T003.md.
//
// Each session owns a fresh Playwright browser + browser context (its own page),
// so concurrent sessions cannot corrupt or merge each other's browser state
// (Acceptance Criterion 5). Sessions are keyed by a random session id, independent
// of the MCP transport session — a single MCP connection is expected to have at
// most one active ui_session at a time, but the registry itself supports many.

import { chromium, type Browser, type BrowserContext, type Dialog, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { truncate } from "../reports/index.js";

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
 *
 * `holdDialogs` (T031, default false): hold native dialogs open for the agent to answer
 * with ui_dialog. Only callers that CAN answer (the MCP `ui_start_session`) set it; REST
 * /api/run-test cannot, so there a dialog is logged and dismissed at once, as before.
 */
export async function startSession(
  target: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  options: { holdDialogs?: boolean } = {}
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
    timeoutHandle,
  };
  sessions.set(id, session);
  attachIssueListeners(session);
  attachDialogHandler(
    page,
    (entry) => {
      if (session.currentStep) entry.step = session.currentStep;
      session.actions.push(entry);
    },
    options.holdDialogs === true
  );
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

// --- T031: native dialogs (alert / confirm / prompt / beforeunload) -----------------
//
// A native dialog blocks the page until it is answered, and Playwright stalls the action
// that opened it (and any evaluate/screenshot) meanwhile. With no listener Playwright
// silently cancels every dialog, so `confirm()` was always false and the message was lost.
// Instead each page gets a listener that HOLDS an unanswered dialog open: the tool call
// that opened it returns at once ("waiting"), and the agent answers with ui_dialog.
// Decision D1 (2026-11-10). State is per Page so the legacy no-session page behaves the same.

export type DialogType = "alert" | "confirm" | "prompt" | "beforeunload";
export type DialogAnswer = "accept" | "dismiss";
export type DialogAnsweredBy = "agent" | "pre-set" | "timeout" | "session-end" | "auto";

/** How long a held dialog waits for the agent before it is answered automatically. Read per
 * dialog so it can be changed without a restart (tests, ops). */
function dialogTimeoutMs(): number {
  const ms = Number(process.env.DIALOG_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 120_000;
}

/** How long ui_dialog waits for the action that opened a dialog to finish once it is answered. */
const ACTION_AFTER_ANSWER_CAP_MS = 10_000;

interface PendingDialog {
  dialog: Dialog;
  type: DialogType;
  message: string;
  defaultValue: string;
  timer: ReturnType<typeof setTimeout>;
  /** When it was answered (by anyone); lets a late tool outcome tell "before" from "after" the answer. */
  answeredAt?: number;
}

/** A page-controlled dialog message, made safe to put in a reply: one JSON-quoted, truncated line. */
export function quoteDialogText(text: string): string {
  return JSON.stringify(truncate(text));
}

/** "a confirm dialog" / "an alert dialog". */
function aDialog(type: DialogType): string {
  return `${type === "alert" ? "an" : "a"} ${type} dialog`;
}

interface DialogState {
  log?: (entry: LoggedAction) => void;
  pending?: PendingDialog;
  /** One answer for the next dialog, set by ui_dialog when nothing is waiting. */
  preset?: { action: DialogAnswer; text?: string };
  /** Things the agent has not been told yet (e.g. a dialog the safety timeout dismissed). */
  notices: string[];
  /** Woken when a dialog is held, so a running tool call can stop waiting on its stalled action. */
  waiters: Array<() => void>;
  /** The tool call that opened the waiting dialog, still running; ui_dialog collects its result. */
  stalled?: Promise<unknown>;
  listener: (dialog: Dialog) => void;
}

const dialogStates = new WeakMap<Page, DialogState>();

async function settleDialog(
  state: DialogState,
  d: Pick<PendingDialog, "dialog" | "type" | "message"> & { answeredAt?: number },
  answer: DialogAnswer,
  text: string | undefined,
  answeredBy: DialogAnsweredBy
): Promise<void> {
  state.log?.({
    timestamp: new Date().toISOString(),
    action: "dialog",
    args: {
      type: d.type,
      message: d.message,
      answer,
      ...(text !== undefined && { text }),
      answeredBy,
    },
    ok: true,
  });
  d.answeredAt = Date.now();
  try {
    if (answer === "accept") await d.dialog.accept(text);
    else await d.dialog.dismiss();
  } catch {
    // The page closed or the dialog was already handled — nothing left to answer.
  }
}

async function expireDialog(state: DialogState): Promise<void> {
  const pending = state.pending;
  if (!pending) return;
  state.pending = undefined;
  state.stalled = undefined;
  const answer: DialogAnswer = pending.type === "alert" ? "accept" : "dismiss";
  state.notices.push(
    `The ${pending.type} dialog ${quoteDialogText(pending.message)} was left unanswered for ${dialogTimeoutMs() / 1000}s and was ${answer === "accept" ? "accepted" : "dismissed"} (timeout).`
  );
  await settleDialog(state, pending, answer, undefined, "timeout");
}

/**
 * Register the dialog listener on `page`. `log` receives one `dialog` action per answered
 * dialog (the session's action log); omit it for the legacy page, which has no report.
 * With `hold` false nobody can answer (REST), so a dialog is dismissed at once, as before T031.
 */
export function attachDialogHandler(page: Page, log?: (entry: LoggedAction) => void, hold = true): void {
  const state: DialogState = { log, notices: [], waiters: [], listener: () => undefined };
  state.listener = (dialog) => {
    const type = dialog.type() as DialogType;
    const message = dialog.message();
    const { preset } = state;
    if (preset) {
      state.preset = undefined;
      void settleDialog(state, { dialog, type, message }, preset.action, preset.text, "pre-set");
      return;
    }
    if (!hold) {
      void settleDialog(state, { dialog, type, message }, "dismiss", undefined, "auto");
      return;
    }
    const timer = setTimeout(() => void expireDialog(state), dialogTimeoutMs());
    timer.unref?.();
    state.pending = { dialog, type, message, defaultValue: dialog.defaultValue(), timer };
    for (const wake of state.waiters.splice(0)) wake();
  };
  dialogStates.set(page, state);
  page.on("dialog", state.listener);
}

function waitingText(p: PendingDialog): string {
  const dflt = p.type === "prompt" ? ` (default value ${quoteDialogText(p.defaultValue)})` : "";
  return `Browser is waiting on ${aDialog(p.type)}: ${quoteDialogText(p.message)}${dflt}. Answer with ui_dialog accept or dismiss (prompt: add text).`;
}

/** The refusal text for any tool call made while a dialog is waiting, or undefined when none is. */
export function waitingDialogText(page: Page | undefined): string | undefined {
  const pending = page && dialogStates.get(page)?.pending;
  if (!pending) return undefined;
  const text = aDialog(pending.type);
  return `${text[0].toUpperCase()}${text.slice(1)} is waiting: ${quoteDialogText(pending.message)} — answer it with ui_dialog first`;
}

/** Messages the agent has not seen yet (e.g. a timeout dismissal). Returned once, then cleared. */
export function takeDialogNotices(page: Page | undefined): string[] {
  const state = page && dialogStates.get(page);
  return state ? state.notices.splice(0) : [];
}

export type GuardedCall<T> = { kind: "done"; value: T } | { kind: "waiting"; text: string };

/** Handed to the running action; `abandoned` turns true if a dialog took over the call. */
export interface DialogCall {
  abandoned: boolean;
  /** The dialog that took the call over (set with `abandoned`). */
  dialog?: { type: DialogType; message: string; answeredAt?: number };
}

/** Tools whose own action is what opens a dialog: a click or key press that "timed out" did its job. */
const OPENER_TOOLS = new Set(["ui_click", "ui_press_key"]);

/**
 * True while the dialog that took `call` over has not been answered (or another one is
 * waiting): the page is blocked, so the call's timeout says nothing about the app. A
 * failure that settles after the answer is a real one and must stay hard.
 */
export function interruptedByDialog(page: Page | undefined, call: DialogCall | undefined): boolean {
  if (!call?.abandoned || !call.dialog) return false;
  const state = page && dialogStates.get(page);
  return call.dialog.answeredAt === undefined || Boolean(state && state.pending);
}

/**
 * Re-label a failed action entry whose call a dialog took over, before it is logged.
 * An opener (click, key press) that hit its timeout because its own dialog blocked the page
 * is `ok`, noting the dialog; anything else becomes a soft "outcome unknown". Entries that
 * succeeded, or settled after the answer, are returned unchanged.
 */
export function applyDialogInterruption(page: Page | undefined, call: DialogCall | undefined, entry: LoggedAction): LoggedAction {
  if (entry.ok || entry.soft || !interruptedByDialog(page, call)) return entry;
  if (OPENER_TOOLS.has(entry.action) && /Timeout \d+ms exceeded/.test(entry.detail ?? "")) {
    const { detail: _detail, ...rest } = entry;
    return { ...rest, ok: true, args: { ...entry.args, opensDialog: call!.dialog!.type } };
  }
  return { ...entry, soft: true, detail: `Interrupted by a native dialog; outcome unknown (${entry.detail ?? "no detail"})` };
}

/**
 * Run `run`, but stop waiting on it the moment a dialog is held open: the page is blocked
 * until the dialog is answered, so `run` would only finish after its own timeout. The
 * unfinished call is kept for ui_dialog; its late failure is swallowed here (the caller
 * reads `call.abandoned` to decide what a failure after abandonment means).
 * `carry` replaces the kept promise (used when ui_dialog itself is interrupted).
 */
export async function raceDialog<T>(
  page: Page | undefined,
  run: (call: DialogCall) => Promise<T>,
  carry?: Promise<unknown>
): Promise<GuardedCall<T>> {
  const call: DialogCall = { abandoned: false };
  const state = page && dialogStates.get(page);
  if (!state) return { kind: "done", value: await run(call) };
  // A dialog is already held (opened in the gap before this call): do not start the action.
  if (state.pending) {
    if (carry) state.stalled = carry;
    return { kind: "waiting", text: waitingText(state.pending) };
  }

  let wake!: () => void;
  const opened = new Promise<void>((resolve) => {
    wake = resolve;
    state.waiters.push(resolve);
  });
  const action = run(call);
  action.catch(() => undefined);
  try {
    const winner = await Promise.race([
      action.then((value) => ({ done: true as const, value })),
      opened.then(() => ({ done: false as const })),
    ]);
    if (winner.done) return { kind: "done", value: winner.value };
    call.abandoned = true;
    call.dialog = state.pending;
    state.stalled = carry ?? action;
    return { kind: "waiting", text: waitingText(state.pending!) };
  } finally {
    const at = state.waiters.indexOf(wake);
    if (at >= 0) state.waiters.splice(at, 1);
  }
}

export interface AnswerOutcome {
  /** True when nothing was waiting and the answer was stored for the next dialog. */
  preset: boolean;
  type?: DialogType;
  message?: string;
  /** What the interrupted tool call returned once the dialog was answered. */
  result?: unknown;
  /** The interrupted call had not finished within the cap; check the page. */
  stillRunning?: boolean;
}

/**
 * Answer the waiting dialog and collect the outcome of the call that opened it. With none
 * waiting, store the answer for the next dialog instead (one slot; replaced if set again).
 * If answering lets the page run into a second dialog, that one is reported as waiting.
 */
export async function answerDialog(
  page: Page,
  action: DialogAnswer,
  text?: string
): Promise<GuardedCall<AnswerOutcome>> {
  const state = dialogStates.get(page);
  if (!state) return { kind: "done", value: { preset: false } };
  const pending = state.pending;
  if (!pending) {
    state.preset = { action, ...(text !== undefined && { text }) };
    return { kind: "done", value: { preset: true } };
  }
  clearTimeout(pending.timer);
  state.pending = undefined;
  const stalled = state.stalled;
  state.stalled = undefined;
  await settleDialog(state, pending, action, text, "agent");
  const base = { preset: false, type: pending.type, message: pending.message };
  if (!stalled) return { kind: "done", value: base };

  let capTimer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await raceDialog(
    page,
    () =>
      Promise.race([
        stalled.then((result) => ({ result, stillRunning: false })),
        new Promise<{ result?: undefined; stillRunning: true }>((resolve) => {
          capTimer = setTimeout(() => resolve({ result: undefined, stillRunning: true }), ACTION_AFTER_ANSWER_CAP_MS);
        }),
      ]),
    stalled
  );
  clearTimeout(capTimer);
  if (outcome.kind === "waiting") return outcome;
  return { kind: "done", value: { ...base, ...outcome.value } };
}

/** Answer anything still waiting and stop listening — before the page/context is closed. */
async function releaseDialog(page: Page): Promise<void> {
  const state = dialogStates.get(page);
  if (!state) return;
  page.off("dialog", state.listener);
  const pending = state.pending;
  state.pending = undefined;
  state.stalled = undefined;
  state.preset = undefined;
  if (pending) {
    clearTimeout(pending.timer);
    await settleDialog(state, pending, "dismiss", undefined, "session-end");
  }
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
  await releaseDialog(session.page);
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
  await releaseDialog(session.page);
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
