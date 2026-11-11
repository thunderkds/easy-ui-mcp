// MCP server entrypoint: HTTP/SSE transport + /health route + ui_navigate tool.
// Tracer-bullet slice (T001) — see tasks/TASK_GUIDE_T001.md.
//
// Transport spike (2026-07-01): confirmed the MCP SDK's StreamableHTTPServerTransport
// runs cleanly inside a single long-lived Express process (session-per-connection via
// the mcp-session-id header), with /health remaining independently responsive. No
// workaround needed. See memory/decisions.md for the full spike record.

import express from "express";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { chromium, type Browser, type Page } from "playwright";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import path from "node:path";
import {
  navigate,
  click,
  fill,
  assertCondition,
  classifyCheckOutcome,
  waitForCondition,
  getPageState,
  renderCompact,
  resolveRefArgs,
  REF_ARGUMENTS,
  takeScreenshot,
  selectOption,
  pressKey,
  hover,
  setChecked,
  scroll,
  getText,
  textSelectorOrUndefined,
  clickOutside,
  describeClick,
  setViewport,
  typeText,
  navigateHistory,
  uploadFile,
  drag,
  mayOpenTabOrDownload,
  getUploadFileSize,
  UPLOAD_FILE_NAME,
  MAX_WAIT_MS,
  type ClickOptions,
  MIN_VIEWPORT_WIDTH,
  MAX_VIEWPORT_WIDTH,
  MIN_VIEWPORT_HEIGHT,
  MAX_VIEWPORT_HEIGHT,
  MAX_TYPE_DELAY_MS,
  MAX_INLINE_WIDTH,
  MAX_INLINE_HEIGHT,
} from "./tools/web.js";
import {
  startSession,
  endSession,
  getSessionPage,
  logAction,
  markFailed,
  isFatalOutcome,
  claimFailureScreenshot,
  setCurrentStep,
  getCurrentStep,
  beginCall,
  endCall,
  formatIdle,
  DEFAULT_TIMEOUT_MS,
  attachDialogHandler,
  applyDialogInterruption,
  cleanError,
  interruptedByDialog,
  quoteDialogText,
  raceDialog,
  answerDialog,
  waitingDialogText,
  takeDialogNotices,
  type DialogCall,
  getSessionLogs,
  takeNotices,
  listTabs,
  switchTab,
  closeTab,
  type LoggedAction,
  type SessionRecord,
} from "./tools/session.js";
import { ConnectionSessions } from "./tools/connection-sessions.js";
import { writeReports } from "./reports/index.js";
import { handleRunTest } from "./api/run-test.js";

const PORT = 8765;

/** T019 tool names — the only place they are spelled in this file (describe() in
 * src/reports/index.ts keys its sentences on the same strings). */
const TOOL = {
  selectOption: "ui_select_option",
  pressKey: "ui_press_key",
  hover: "ui_hover",
  setChecked: "ui_set_checked",
  scroll: "ui_scroll",
  getText: "ui_get_text",
  clickOutside: "ui_click_outside",
  dialog: "ui_dialog",
  // T032
  setViewport: "ui_set_viewport",
  type: "ui_type",
  navigateHistory: "ui_navigate_history",
  getLogs: "ui_get_logs",
  tabs: "ui_tabs",
  uploadFile: "ui_upload_file",
  drag: "ui_drag",
} as const;

/** What `ui_type` leaves in the report in place of the text it typed into a password field. */
const MASKED_TEXT = "••••";

const SELECTOR_DESCRIPTION = "Selector or `@eN` / `@oN` ref; must match one element";
const REPORTS_DIR = path.join(process.cwd(), "reports");
const MAX_SESSIONS_PER_CONNECTION = Number(process.env.MAX_SESSIONS_PER_CONNECTION ?? 3);

/** Optional on every session-aware tool (T029). Spread into each inputSchema. */
const sessionIdShape = {
  session_id: z
    .string()
    .optional()
    .describe("Session id from ui_start_session"),
};

const app = express();
app.use(express.json());
// Malformed JSON bodies otherwise fall through to Express's default handler,
// which echoes the parser's stack trace (internal file paths) to the caller.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in (err as object)) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  next(err);
});

// Single shared browser/page, used only when no ui_session is active for this
// connection (kept for backward-compat with T001/T002 direct tool usage).
let browser: Browser | undefined;
let page: Page | undefined;

async function getPage(): Promise<Page> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  if (!page || page.isClosed()) {
    page = await browser.newPage();
    attachDialogHandler(page);
  }
  return page;
}

/** Closes the shared legacy browser, if one was launched. Used by the SIGTERM handler and src/stdio.ts. */
export async function closeBrowser(): Promise<void> {
  if (browser) await browser.close();
}

/** Session endings started by a closed connection (see `onclose` in buildMcpServer). src/stdio.ts
 * waits for them before exiting, so the process does not leave before the reports are written. */
const closing = new Set<Promise<void>>();
export async function settleClosing(): Promise<void> {
  await Promise.all(closing);
}

/** Returns the current page without creating one (undefined if ui_navigate hasn't run yet). */
function currentPage(): Page | undefined {
  return page && !page.isClosed() ? page : undefined;
}

type ToolResponse = { isError?: boolean; content: Array<{ type: "text"; text: string }> };

/** Tools that never refuse and never race a dialog: they are the way out of one, or never touch the page. */
const DIALOG_EXEMPT_TOOLS = new Set(["ui_step", TOOL.dialog]);
/** Tools that may create the legacy page, so the dialog listener must exist before they run. */
const PAGE_CREATING_TOOLS = new Set(["ui_navigate"]);
/** Tools whose own action opens a dialog (a click, a key press), so a timeout on them is expected. */
const OPENER_TOOLS = new Set(["ui_click", "ui_press_key"]);
/** Replies standing in for a call a dialog interrupted; ui_dialog states them as they are. */
const interruptedReplies = new WeakSet<object>();

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "easy-ui-mcp", version: "0.1.0" });

  // The sessions this connection owns (T029). It can reach no others.
  const owned = new ConnectionSessions(MAX_SESSIONS_PER_CONNECTION);
  // The session the running tool call acts on; set by registerSessionTool. A tool call
  // outside registerSessionTool acts on no session (the legacy shared page).
  // `dialogCall` is the running call a native dialog may take over (T031); read by recordAction.
  const callContext = new AsyncLocalStorage<{ sessionId?: string; dialogCall?: DialogCall }>();
  const callSessionId = () => callContext.getStore()?.sessionId;

  /** The idle timer closed one of this connection's sessions: free its slot, remember
   * why, and still write the report so the agent's work is not lost (D5). */
  async function onIdle(record: SessionRecord): Promise<void> {
    owned.markIdleClosed(record.id, formatIdle(DEFAULT_TIMEOUT_MS));
    try {
      await writeReports(record, REPORTS_DIR);
    } catch (err) {
      console.error(`[session ${record.id}] could not write the report after an idle close:`, err);
    }
  }

  // The connection closed: end every session it still owns, so no Chromium outlives it.
  // (A client that vanishes without closing is caught by the idle timer instead.)
  server.server.onclose = () => {
    for (const id of owned.drain()) {
      const ending = endSession(id).then(async (record) => {
        if (!record) return;
        try {
          await writeReports(record, REPORTS_DIR);
        } catch (err) {
          console.error(`[session ${id}] could not write the report after the connection closed:`, err);
        }
      });
      closing.add(ending);
      void ending.finally(() => closing.delete(ending));
    }
  };

  /** `server.registerTool` for a session-aware tool: adds the optional `session_id` input,
   * picks the session from it (or refuses the call, per D1/ownership), and keeps that
   * session's idle clock stopped while the call runs. */
  function registerSessionTool<S extends ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: S },
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<CallToolResult>
  ): void {
    const inputSchema: ZodRawShape = { ...config.inputSchema, ...sessionIdShape };
    server.registerTool(name, { ...config, inputSchema }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      const { sessionId, error } = owned.resolve(args.session_id as string | undefined);
      if (error) return { isError: true, content: [{ type: "text", text: error }] };
      if (sessionId) beginCall(sessionId);
      try {
        return await guardDialog(name, sessionId, async () => {
          // T040: a ref becomes its selector here, once, so the handler, the action log and the
          // report all see a normal selector. Inside guardDialog, so a held dialog refuses first.
          const resolved = await resolveRefArgs(resolvePageForRead(), args);
          if (!resolved.ok) {
            const tried = Object.fromEntries(REF_ARGUMENTS.filter((k) => typeof args[k] === "string").map((k) => [k, args[k]]));
            // Soft: a stale or unknown ref is the agent using old information, not a fault of the app under test.
            await recordAction(name, tried, false, resolved.error, true);
            return { isError: true, content: [{ type: "text" as const, text: resolved.error }] };
          }
          return (await handler(resolved.args as z.infer<z.ZodObject<S>>)) as ToolResponse;
        });
      } finally {
        if (sessionId) endCall(sessionId);
      }
    });
  }

  /**
   * Every session-aware tool goes through this (T031, decision D1). A native dialog blocks
   * its page, and each session has its own page, so the rule is per session: while a dialog
   * is waiting in session A, every tool but the exempt ones is refused for A, and B is
   * untouched. A call that opens a dialog returns at once with "waiting" instead of hanging
   * until its own timeout; the abandoned call keeps running and ui_dialog collects its
   * result. Notices (e.g. a dialog the safety timeout dismissed) ride on the next response.
   */
  async function guardDialog(
    name: string,
    sessionId: string | undefined,
    run: () => Promise<ToolResponse>
  ): Promise<ToolResponse> {
    const target = sessionId
      ? getSessionPage(sessionId)
      : PAGE_CREATING_TOOLS.has(name)
        ? await getPage()
        : currentPage();
    const withNotices = (res: ToolResponse): ToolResponse => {
      // Dialog notices (T031) plus what the session's browser did since the last reply: new tab, download (T033).
      const notices = [...takeDialogNotices(target), ...(sessionId ? takeNotices(sessionId) : [])];
      return notices.length === 0
        ? res
        : { ...res, content: [...res.content, ...notices.map((text) => ({ type: "text" as const, text }))] };
    };
    if (DIALOG_EXEMPT_TOOLS.has(name)) return withNotices(await callContext.run({ sessionId }, run));

    const waiting = waitingDialogText(target);
    if (waiting) return { isError: true, content: [{ type: "text", text: waiting }] };

    const outcome = await raceDialog(target, (call) =>
      callContext.run({ sessionId, dialogCall: call }, async () => {
        const res = await run();
        if (!res.isError || !interruptedByDialog(target, call)) return res;
        const why = res.content.map((c) => c.text).join(" ");
        const text = OPENER_TOOLS.has(name)
          ? `The ${name} that opened the dialog was interrupted by it; that is expected.`
          : `The call was interrupted by the dialog and its own outcome is unknown (${why}).`;
        const replaced: ToolResponse = { content: [{ type: "text" as const, text }] };
        interruptedReplies.add(replaced);
        return replaced;
      })
    );
    if (outcome.kind === "waiting") return { content: [{ type: "text", text: outcome.text }] };
    return withNotices(outcome.value);
  }

  /** Resolves the page primitive tools should act on: the resolved session's
   * page if one is open, otherwise the legacy shared page. */
  async function resolvePageForWrite(): Promise<Page> {
    const sessionId = callSessionId();
    if (sessionId) {
      const sessionPage = getSessionPage(sessionId);
      if (sessionPage) return sessionPage;
    }
    return getPage();
  }

  function resolvePageForRead(): Page | undefined {
    const sessionId = callSessionId();
    if (sessionId) {
      return getSessionPage(sessionId);
    }
    return currentPage();
  }

  /**
   * Logs `action`'s outcome to the active session (no-op if no session is
   * active). On a fatal failing step, marks the session failed and captures a
   * screenshot for the report (NFR-007).
   *
   * `soft: true` records the outcome without condemning the run and without
   * spending a screenshot — the ui_check path (FR-014). Screenshot capture is
   * also budgeted per session, so a run with many failures does not write a PNG
   * for every one (NFR-008).
   */
  async function recordAction(
    name: string,
    args: Record<string, unknown> | undefined,
    ok: boolean,
    detail?: string,
    soft?: boolean
  ): Promise<void> {
    const sessionId = callSessionId();
    if (!sessionId) return;
    let entry: LoggedAction = { timestamp: new Date().toISOString(), action: name, args, ok, detail };
    if (soft) entry.soft = true;
    // A call a native dialog took over (T031) hits its own timeout while the page is blocked, so
    // a failure that settles BEFORE the dialog is answered says nothing about the app; one after
    // the answer is real and stays hard.
    entry = applyDialogInterruption(getSessionPage(sessionId), callContext.getStore()?.dialogCall, entry);
    const step = getCurrentStep(sessionId);
    if (step) entry.step = step;
    logAction(sessionId, entry);
    if (!isFatalOutcome(entry)) return;

    if (claimFailureScreenshot(sessionId)) {
      const sessionPage = getSessionPage(sessionId);
      const shot = await takeScreenshot(sessionPage, REPORTS_DIR);
      markFailed(sessionId, shot.ok ? shot.path : undefined);
      return;
    }
    markFailed(sessionId);
  }

  /**
   * Shared body of the T019 interaction tools, identical in shape to ui_click:
   * fail clearly with no active page, run the action, record it (a failure is hard),
   * and answer with `isError` on failure.
   */
  async function runInteraction<R extends { ok: boolean; error?: string }>(
    name: string,
    args: Record<string, unknown>,
    act: (target: Page) => Promise<R>,
    successText: string | ((result: R) => string)
  ) {
    const target = resolvePageForRead();
    if (!target) {
      await recordAction(name, args, false, "No active page");
      return { isError: true, content: [{ type: "text" as const, text: "No active page — call ui_navigate first" }] };
    }
    const result = await act(target);
    await recordAction(name, args, result.ok, result.error);
    if (!result.ok) {
      return { isError: true, content: [{ type: "text" as const, text: result.error ?? `${name} failed` }] };
    }
    return {
      content: [{ type: "text" as const, text: typeof successText === "function" ? successText(result) : successText }],
    };
  }

  server.registerTool(
    "ui_start_session",
    {
      title: "ui_start_session",
      description:
        "Open a fresh browser session and log the following tool calls into a report; returns a session id. " +
        "A connection can hold several sessions (up to MAX_SESSIONS_PER_CONNECTION, default 3): pass the id as `session_id` to the other tools " +
        "(optional with one open session, required with several). A session unused for 10 minutes is closed and its report written with status timed_out. " +
        "Native alert/confirm/prompt dialogs are held for you during a session (answer with ui_dialog). " +
        "Default is a 1280x720 desktop; set `device`, `viewport`, `colorScheme`, `locale` or `timezoneId` to test as real users do (this session only; ui_set_viewport resizes later).",
      inputSchema: {
        target: z.string().describe("Label or URL of what this session tests"),
        viewport: z
          .object({
            width: z.number().int().min(MIN_VIEWPORT_WIDTH).max(MAX_VIEWPORT_WIDTH),
            height: z.number().int().min(MIN_VIEWPORT_HEIGHT).max(MAX_VIEWPORT_HEIGHT),
          })
          .optional()
          .describe("CSS pixels; overrides the device size, e.g. {width: 375, height: 812}"),
        device: z.string().optional().describe('Playwright device name (mobile user agent, touch, size), e.g. "iPhone 13", "Pixel 7"'),
        colorScheme: z.enum(["light", "dark"]).optional(),
        locale: z.string().optional().describe('e.g. "fr-FR"'),
        timezoneId: z.string().optional().describe('IANA, e.g. "Asia/Tokyo"'),
      },
    },
    async ({ target, viewport, device, colorScheme, locale, timezoneId }) => {
      const refusal = owned.tryReserve();
      if (refusal) return { isError: true, content: [{ type: "text", text: refusal }] };
      const settings = {
        ...(viewport && { viewport }),
        ...(device !== undefined && { device }),
        ...(colorScheme && { colorScheme }),
        ...(locale !== undefined && { locale }),
        ...(timezoneId !== undefined && { timezoneId }),
      };
      let record: SessionRecord;
      try {
        record = await startSession(target, DEFAULT_TIMEOUT_MS, onIdle, { holdDialogs: true, settings });
      } catch (err) {
        owned.cancelReservation();
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Could not start the session: ${message}` }] };
      }
      owned.add(record.id);
      const applied = Object.entries(settings)
        .map(([key, value]) => `${key} ${typeof value === "object" ? `${value.width}x${value.height}` : value}`)
        .join(", ");
      return {
        content: [{ type: "text", text: `Session ${record.id} started for target "${target}"${applied ? ` (${applied})` : ""}` }],
      };
    }
  );

  server.registerTool(
    "ui_end_session",
    {
      title: "ui_end_session",
      description:
        "Close the session and write its JSON and HTML report; returns their paths.",
      inputSchema: { ...sessionIdShape },
    },
    async ({ session_id }) => {
      const { sessionId: id, error } = owned.resolve(session_id);
      if (error) return { isError: true, content: [{ type: "text", text: error }] };
      if (!id) {
        return {
          isError: true,
          content: [{ type: "text", text: "No active session — call ui_start_session first" }],
        };
      }
      owned.remove(id);
      const record = await endSession(id);
      if (!record) {
        return { isError: true, content: [{ type: "text", text: `Unknown session ${id}` }] };
      }
      try {
        const { jsonPath, htmlPath } = await writeReports(record, REPORTS_DIR);
        return {
          content: [
            {
              type: "text",
              text: `Session ${id} ended (${record.status}). Reports: ${jsonPath}, ${htmlPath}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `Session ${id} ended (${record.status}) but report generation failed: ${message}` }],
        };
      }
    }
  );

  registerSessionTool(
    "ui_navigate",
    {
      title: "ui_navigate",
      description: "Navigate to a URL and report the result.",
      inputSchema: { url: z.string() },
    },
    async ({ url }) => {
      const target = await resolvePageForWrite();
      const result = await navigate(target, url);
      await recordAction("ui_navigate", { url }, result.ok, result.ok ? result.url : result.error);
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `Navigation failed: ${result.error}` }],
        };
      }
      return {
        content: [
          { type: "text", text: `Navigated to ${result.url} (title: "${result.title}")` },
        ],
      };
    }
  );

  registerSessionTool(
    "ui_click",
    {
      title: "ui_click",
      description:
        "Click the one element matching `selector`; optional `button`, `clickCount`, `modifiers`, `position`, `force`. " +
        "If the click opens a native alert/confirm/prompt, the reply says the browser is waiting: answer it with ui_dialog.",
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        button: z.enum(["left", "right", "middle"]).optional().describe("Default left; right fires contextmenu"),
        clickCount: z.number().int().min(1).max(3).optional().describe("2 = double-click, 3 = triple (default 1)"),
        modifiers: z
          .array(z.enum(["Alt", "Control", "Meta", "Shift", "ControlOrMeta"]))
          .optional()
          .describe("Keys held during the click, e.g. [\"Shift\"]"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Offset from the top-left corner in CSS px (default: centre)"),
        force: z
          .boolean()
          .optional()
          .describe("Click through a covering element (e.g. a transparent overlay); it lands on whatever is on top"),
      },
    },
    async ({ selector, button, clickCount, modifiers, position, force }) => {
      // Only options the caller set are logged, so the report never claims a default as a choice.
      const options: ClickOptions = {
        ...(button !== undefined && { button }),
        ...(clickCount !== undefined && { clickCount }),
        ...(modifiers !== undefined && { modifiers }),
        ...(position !== undefined && { position }),
        ...(force !== undefined && { force }),
      };
      const args = { selector, ...options };
      const target = resolvePageForRead();
      if (!target) {
        await recordAction("ui_click", args, false, "No active page");
        return { isError: true, content: [{ type: "text", text: "No active page — call ui_navigate first" }] };
      }
      const mayOpen = callSessionId() ? await mayOpenTabOrDownload(target, selector) : false;
      const result = await click(target, selector, options);
      await recordAction("ui_click", args, result.ok, result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Click failed" }] };
      }
      // Only a click that can open a tab or start a download waits for the event, so the notice rides this reply; any other click returns at once.
      if (mayOpen) await new Promise((resolve) => setTimeout(resolve, 150));
      return { content: [{ type: "text", text: describeClick(`"${selector}"`, options) }] };
    }
  );

  registerSessionTool(
    TOOL.clickOutside,
    {
      title: TOOL.clickOutside,
      description:
        "Close a modal, drawer or popover the way a user does: click just outside the element matching `selector` (pass the panel, not the backdrop) on a point that is not a control; says what it hit. " +
        "Fails if no safe point exists (the element fills the viewport): use ui_press_key with Escape then.",
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
      },
    },
    async ({ selector }) => {
      const target = resolvePageForRead();
      if (!target) {
        await recordAction(TOOL.clickOutside, { selector }, false, "No active page");
        return { isError: true, content: [{ type: "text", text: "No active page — call ui_navigate first" }] };
      }
      const result = await clickOutside(target, selector);
      await recordAction(TOOL.clickOutside, result.ok ? { selector, hit: result.hit } : { selector }, result.ok, result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Click outside failed" }] };
      }
      return {
        content: [{ type: "text", text: `Clicked outside "${selector}" at ${result.x},${result.y} (on ${result.hit})` }],
      };
    }
  );

  /** The page's URL and title right now, for replies that follow a dialog answer; never blocks on a blocked page. */
  async function pageNow(target: Page): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const title = await Promise.race([
      target.title().catch(() => ""),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), 2_000);
      }),
    ]);
    clearTimeout(timer);
    return `${target.url()} (title: ${JSON.stringify(title)})`;
  }

  registerSessionTool(
    TOOL.dialog,
    {
      title: TOOL.dialog,
      description:
        "Answer a native browser dialog (alert, confirm, prompt, beforeunload). When a tool call opens one, its reply says the browser is waiting and every other tool is refused until you answer here; the reply then reports what the interrupted action did. " +
        "With no dialog waiting, it pre-sets the answer for the next dialog (used once). An unanswered dialog is dismissed after a safety timeout.",
      inputSchema: {
        action: z.enum(["accept", "dismiss"]).describe("accept = OK / Leave; dismiss = Cancel / Stay"),
        text: z.string().optional().describe("Answer for a prompt (accept only)"),
      },
    },
    async ({ action, text }) => {
      const target = resolvePageForRead();
      if (!target) {
        await recordAction(TOOL.dialog, { action }, false, "No active page");
        return { isError: true, content: [{ type: "text", text: "No active page — call ui_navigate first" }] };
      }
      const outcome = await answerDialog(target, action, action === "accept" ? text : undefined);
      if (outcome.kind === "waiting") return { content: [{ type: "text", text: outcome.text }] };
      const answered = outcome.value;
      if (answered.preset) {
        await recordAction(TOOL.dialog, { action }, true);
        return {
          content: [
            {
              type: "text",
              text: `No dialog is waiting. The next dialog will be ${action === "accept" ? "accepted" : "dismissed"} without pausing.`,
            },
          ],
        };
      }
      const lines = [
        `${action === "accept" ? "Accepted" : "Dismissed"} the ${answered.type} dialog ${quoteDialogText(answered.message ?? "")}.`,
      ];
      const done = answered.result as ToolResponse | undefined;
      const now = await pageNow(target);
      const interrupted = done?.content ? interruptedReplies.has(done) : false;
      const failed = Boolean(done?.isError) && !interrupted;
      const said = cleanError(done?.content?.map((c) => c.text).join(" "));
      if (answered.type === "beforeunload" && action === "dismiss") {
        // The navigation that raised the prompt is rejected with ERR_ABORTED: that is the Stay.
        lines.push(`Stayed on ${now}.`);
        if (failed && !/ERR_ABORTED/.test(said)) lines.push(`The interrupted call failed: ${said}`);
      } else {
        if (answered.stillRunning) {
          lines.push("The action that opened it is still running.");
        } else if (interrupted) {
          lines.push(said);
        } else if (failed) {
          lines.push(`The interrupted call failed: ${said}`);
        } else if (done?.content) {
          lines.push(`The interrupted call then returned: ${said}`);
        }
        lines.push(`Page now: ${now}.`);
      }
      return { content: [{ type: "text", text: lines.join(" ") }] };
    }
  );

  registerSessionTool(
    "ui_fill",
    {
      title: "ui_fill",
      description:
        "Replace the value of the one input matching `selector` at once; for inputs that react to each keystroke use ui_type.",
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        value: z.string(),
      },
    },
    async ({ selector, value }) => {
      const target = resolvePageForRead();
      if (!target) {
        await recordAction("ui_fill", { selector, value }, false, "No active page");
        return { isError: true, content: [{ type: "text", text: "No active page — call ui_navigate first" }] };
      }
      const result = await fill(target, selector, value);
      await recordAction("ui_fill", { selector, value }, result.ok, result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Fill failed" }] };
      }
      return { content: [{ type: "text", text: `Filled "${selector}" with "${value}"` }] };
    }
  );

  registerSessionTool(
    TOOL.selectOption,
    {
      title: TOOL.selectOption,
      description:
        "Choose an option of the one <select> matching `selector`, by option value or visible label. For a <select multiple> this selects exactly that option.",
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        value: z.string(),
      },
    },
    async ({ selector, value }) =>
      runInteraction(
        TOOL.selectOption,
        { selector, value },
        (target) => selectOption(target, selector, value),
        `Selected "${value}" in "${selector}"`
      )
  );

  registerSessionTool(
    TOOL.pressKey,
    {
      title: TOOL.pressKey,
      description:
        "Press a key (Playwright name such as Enter, Tab, Escape, ArrowDown, or a combo like Control+a) on `selector`, or on whatever has focus without one. Enter in a text input submits its form.",
      inputSchema: {
        key: z.string(),
        selector: z.string().optional().describe(SELECTOR_DESCRIPTION),
      },
    },
    async ({ key, selector }) =>
      runInteraction(
        TOOL.pressKey,
        selector === undefined ? { key } : { key, selector },
        (target) => pressKey(target, key, selector),
        selector === undefined ? `Pressed ${key}` : `Pressed ${key} in "${selector}"`
      )
  );

  registerSessionTool(
    TOOL.hover,
    {
      title: TOOL.hover,
      description:
        "Move the pointer over the one element matching `selector`, to reveal :hover or mouseenter content such as dropdown menus.",
      inputSchema: { selector: z.string().describe(SELECTOR_DESCRIPTION) },
    },
    async ({ selector }) =>
      runInteraction(TOOL.hover, { selector }, (target) => hover(target, selector), `Hovered over "${selector}"`)
  );

  registerSessionTool(
    TOOL.setChecked,
    {
      title: TOOL.setChecked,
      description:
        "Set the one checkbox or radio matching `selector` to checked or unchecked. Idempotent; a radio cannot be unchecked directly.",
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        checked: z.boolean(),
      },
    },
    async ({ selector, checked }) =>
      runInteraction(
        TOOL.setChecked,
        { selector, checked },
        (target) => setChecked(target, selector, checked),
        `Set "${selector}" to ${checked ? "checked" : "unchecked"}`
      )
  );

  registerSessionTool(
    TOOL.scroll,
    {
      title: TOOL.scroll,
      description:
        "Scroll one step: with `selector`, bring that element into view; otherwise move one viewport step in `direction` (default down; top / bottom jump to the end), " +
        "in the page or in the `container` scroll area (chat panel, virtual table, carousel). " +
        "The reply says when the end is reached: stop looping then. Nothing to scroll is not an error.",
      inputSchema: {
        selector: z.string().optional().describe(SELECTOR_DESCRIPTION + "; scrolled into view. Not with container or direction"),
        container: z.string().optional().describe(SELECTOR_DESCRIPTION + "; omit to scroll the page"),
        direction: z.enum(["down", "up", "left", "right", "top", "bottom"]).optional(),
      },
    },
    async ({ selector, container, direction }) =>
      runInteraction(
        TOOL.scroll,
        {
          ...(selector !== undefined && { selector }),
          ...(container !== undefined && { container }),
          ...(direction !== undefined && { direction }),
        },
        (target) => scroll(target, selector, { container, direction }),
        (result) => result.message ?? `Scrolled "${selector}" into view`
      )
  );

  registerSessionTool(
    TOOL.setViewport,
    {
      title: TOOL.setViewport,
      description:
        `Resize the viewport to whole CSS pixels (${MIN_VIEWPORT_WIDTH}-${MAX_VIEWPORT_WIDTH} x ${MIN_VIEWPORT_HEIGHT}-${MAX_VIEWPORT_HEIGHT}), e.g. 375x812 for a phone. ` +
        "Layouts can change, so call ui_get_page_state again afterwards.",
      inputSchema: {
        width: z.number().int().min(MIN_VIEWPORT_WIDTH).max(MAX_VIEWPORT_WIDTH),
        height: z.number().int().min(MIN_VIEWPORT_HEIGHT).max(MAX_VIEWPORT_HEIGHT),
      },
    },
    async ({ width, height }) =>
      runInteraction(
        TOOL.setViewport,
        { width, height },
        (target) => setViewport(target, width, height),
        (result) => result.message ?? `Viewport set to ${width}x${height}`
      )
  );

  registerSessionTool(
    TOOL.type,
    {
      title: TOOL.type,
      description:
        "Type text into the one editable element matching `selector` key by key like a user (keydown, input, keyup per character), appending to the current value. " +
        "Use it instead of ui_fill for autocomplete, search-as-you-type, masked inputs and OTP boxes. " +
        "Text typed into a password, one-time-code or card-number field is never stored in the report.",
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        text: z.string(),
        delayMs: z
          .number()
          .int()
          .min(0)
          .max(MAX_TYPE_DELAY_MS)
          .optional()
          .describe(`Pause between keystrokes in ms (0-${MAX_TYPE_DELAY_MS}, default 0)`),
      },
    },
    async ({ selector, text, delayMs }) => {
      const target = resolvePageForRead();
      if (!target) {
        await recordAction(TOOL.type, { selector, text: MASKED_TEXT }, false, "No active page");
        return { isError: true, content: [{ type: "text", text: "No active page — call ui_navigate first" }] };
      }
      const result = await typeText(target, selector, text, delayMs);
      // Only a target positively known not to be a password may have its text kept.
      const shown = result.masked ? MASKED_TEXT : text;
      await recordAction(
        TOOL.type,
        { selector, text: shown, ...(delayMs ? { delayMs } : {}) },
        result.ok,
        result.error
      );
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Type failed" }] };
      }
      return { content: [{ type: "text", text: `Typed "${shown}" into "${selector}"` }] };
    }
  );

  registerSessionTool(
    TOOL.navigateHistory,
    {
      title: TOOL.navigateHistory,
      description:
        "Go back or forward in the history, or reload, and report the resulting URL and title. " +
        "Unlike ui_navigate it keeps the history. Back or forward with no such entry is an error.",
      inputSchema: {
        action: z.enum(["back", "forward", "reload"]),
      },
    },
    async ({ action }) =>
      runInteraction(
        TOOL.navigateHistory,
        { action },
        (target) => navigateHistory(target, action),
        (result) =>
          `${action === "back" ? "Went back to" : action === "forward" ? "Went forward to" : "Reloaded"} ${result.url} (title: "${result.title}")`
      )
  );

  registerSessionTool(
    TOOL.uploadFile,
    {
      title: TOOL.uploadFile,
      description:
        `Upload the built-in test file ${UPLOAD_FILE_NAME} (a tiny PNG) to the one element matching \`selector\`: an input[type=file] (hidden ones work) or a button/label that opens the file chooser. Takes no path: it can upload nothing else. The reply warns if the input's accept excludes images.`,
      inputSchema: { selector: z.string().describe(SELECTOR_DESCRIPTION) },
    },
    async ({ selector }) => {
      const size = await getUploadFileSize();
      return runInteraction(
        TOOL.uploadFile,
        size === undefined ? { selector, file: UPLOAD_FILE_NAME } : { selector, file: UPLOAD_FILE_NAME, size },
        (target) => uploadFile(target, selector),
        (result) =>
          `Uploaded ${UPLOAD_FILE_NAME} (${size} bytes) to "${selector}"` +
          (result.warning ? `. Warning: ${result.warning}` : "")
      );
    }
  );

  registerSessionTool(
    TOOL.drag,
    {
      title: TOOL.drag,
      description:
        "Drag the one element matching `from` onto the one matching `to` with real pointer events: HTML5 drag-and-drop lists, kanban cards, pointer-based sortables.",
      inputSchema: {
        from: z.string().describe(SELECTOR_DESCRIPTION),
        to: z.string().describe(SELECTOR_DESCRIPTION),
      },
    },
    async ({ from, to }) =>
      runInteraction(TOOL.drag, { from, to }, (target) => drag(target, from, to), `Dragged "${from}" onto "${to}"`)
  );

  registerSessionTool(
    TOOL.getLogs,
    {
      title: TOOL.getLogs,
      description:
        "Read the browser problems captured in this session: console errors, page errors, failed requests and HTTP 4xx/5xx responses (method + URL only). Use it when an action seemed to do nothing. Repeats are grouped (×N); at most 50 lines.",
      inputSchema: {
        since: z.enum(["start", "last"]).optional().describe("last (default): new since the previous call; start: everything"),
        level: z.enum(["error", "warning"]).optional().describe("error (default); warning adds console warnings"),
      },
    },
    async ({ since, level }) => {
      const args = { since: since ?? "last", level: level ?? "error" };
      const sessionId = callSessionId();
      if (!sessionId) {
        return { isError: true, content: [{ type: "text" as const, text: "No active session — call ui_start_session first" }] };
      }
      const result = getSessionLogs(sessionId, args);
      await recordAction(TOOL.getLogs, args, result.ok, result.ok ? `${result.lines.length} line(s)` : result.error);
      if (!result.ok) return { isError: true, content: [{ type: "text" as const, text: result.error }] };
      const body = result.lines.length === 0 ? "No new browser issues" : result.lines.join("\n");
      return { content: [{ type: "text" as const, text: result.note ? `${body}\n${result.note}` : body }] };
    }
  );

  registerSessionTool(
    TOOL.tabs,
    {
      title: TOOL.tabs,
      description:
        "Manage this session's tabs (numbered from 1): list (index, url, title, current), switch (every tool then acts on that tab), close (default: current; the last tab cannot be closed). A new tab (target=_blank, window.open) is announced in the next reply but not switched to.",
      inputSchema: {
        action: z.enum(["list", "switch", "close"]),
        index: z.number().int().optional().describe("Tab number from list (required for switch)"),
      },
    },
    async ({ action, index }) => {
      const args = index === undefined ? { action } : { action, index };
      const sessionId = callSessionId();
      if (!sessionId) {
        return { isError: true, content: [{ type: "text" as const, text: "No active session — call ui_start_session first" }] };
      }
      if (action === "list") {
        const tabs = await listTabs(sessionId);
        await recordAction(TOOL.tabs, args, true);
        return { content: [{ type: "text" as const, text: JSON.stringify(tabs) }] };
      }
      const result = action === "switch" ? await switchTab(sessionId, index) : await closeTab(sessionId, index);
      await recordAction(TOOL.tabs, args, result.ok, result.ok ? undefined : result.error);
      if (!result.ok) return { isError: true, content: [{ type: "text" as const, text: result.error }] };
      return { content: [{ type: "text" as const, text: result.message }] };
    }
  );

  registerSessionTool(
    "ui_assert",
    {
      title: "ui_assert",
      description:
        "Assert a JS expression in the page. HARD check: false fails the whole session, so use it only for claims about the app under test, never in a retry loop. " +
        "To wait for the page use ui_wait_for; for a non-fatal observation use ui_check.",
      inputSchema: {
        condition: z.string().describe("JS expression evaluated in the page"),
      },
    },
    async ({ condition }) => {
      const result = await assertCondition(resolvePageForRead(), condition);
      await recordAction(
        "ui_assert",
        { condition },
        result.ok && result.passed === true,
        result.ok ? (result.passed ? undefined : "Assertion evaluated false") : result.error
      );
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Assertion failed to run" }] };
      }
      return {
        content: [{ type: "text", text: result.passed ? "Assertion passed" : "Assertion failed" }],
      };
    }
  );

  registerSessionTool(
    "ui_step",
    {
      title: "ui_step",
      description:
        "Label the actions that follow, in plain language (e.g. \"Log in as jcarlin\"), until the next ui_step. " +
        "Call it before each meaningful part of the flow: the label is the report's only human-readable description, so write it for the person reading the result.",
      inputSchema: {
        label: z.string().min(1),
      },
    },
    async ({ label }) => {
      const sessionId = callSessionId();
      if (!sessionId) {
        return {
          isError: true,
          content: [{ type: "text", text: "No active session — call ui_start_session first" }],
        };
      }
      const trimmed = label.trim();
      if (trimmed === "") {
        return { isError: true, content: [{ type: "text", text: "Step label cannot be blank" }] };
      }
      setCurrentStep(sessionId, trimmed);
      await recordAction("ui_step", { label: trimmed }, true);
      return { content: [{ type: "text", text: `Step: ${trimmed}` }] };
    }
  );

  registerSessionTool(
    "ui_check",
    {
      title: "ui_check",
      description:
        "Check a JS expression in the page and record a soft result in the report; false does NOT fail the session. " +
        "If the expression cannot run (no page open, or it throws) that is still a hard failure.",
      inputSchema: {
        condition: z.string().describe("JS expression evaluated in the page"),
      },
    },
    async ({ condition }) => {
      const result = await assertCondition(resolvePageForRead(), condition);
      const outcome = classifyCheckOutcome(result);
      await recordAction("ui_check", { condition }, outcome.ok, outcome.detail, outcome.soft);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Check failed to run" }] };
      }
      return {
        content: [{ type: "text", text: result.passed ? "Check passed" : "Check evaluated false (session not failed)" }],
      };
    }
  );

  registerSessionTool(
    "ui_wait_for",
    {
      title: "ui_wait_for",
      description:
        "Poll a JS expression until it is true or the timeout passes; use it instead of retrying ui_assert. A timeout fails the session.",
      inputSchema: {
        condition: z.string().describe("JS expression evaluated in the page"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(MAX_WAIT_MS)
          .default(5000)
          .describe(`Polling limit in ms (max ${MAX_WAIT_MS}, default 5000)`),
      },
    },
    async ({ condition, timeoutMs }) => {
      const result = await waitForCondition(resolvePageForRead(), condition, timeoutMs);
      await recordAction("ui_wait_for", { condition, timeoutMs }, result.ok, result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Wait failed" }] };
      }
      return {
        content: [{ type: "text", text: `Condition held after ${result.elapsedMs}ms` }],
      };
    }
  );

  registerSessionTool(
    "ui_get_page_state",
    {
      title: "ui_get_page_state",
      description:
        "Return the current page as text: `url:`, `title:`, one line per visible interactive element `@eN role \"name\"` plus non-default state " +
        "(disabled, checked, value, expanded, selected, pressed, required, invalid; a password's value is never shown; at most 200 elements; custom widgets such as combobox, switch, slider included), " +
        "`overlay @oN ...` per open dialog (topmost first), `focused:` and `messages:` (visible alert/status text). " +
        "Selector arguments of any tool take a CSS / Playwright selector or one of these refs. A ref is valid only for the latest snapshot, and a selector containing \"nth=\" is positional: after the page changes call this again. " +
        "`viewport: true` lists only elements on screen, `within` only those inside one element; a note gives how many were left out. " +
        "`format: \"full\"` returns JSON with a verified `selector` per element and no refs. To read page text use ui_get_text.",
      inputSchema: {
        format: z
          .enum(["compact", "full"])
          .optional()
          .describe("compact (default): text lines with refs. full: JSON with selectors"),
        viewport: z.boolean().optional().describe("true: only elements on screen now"),
        within: z.string().min(1).optional().describe(SELECTOR_DESCRIPTION + "; list only what is inside it"),
      },
    },
    async ({ format, viewport, within }) => {
      const result = await getPageState(resolvePageForRead(), { keepRefs: format !== "full", selectors: format === "full", viewport, within });
      // A `within` that names no single element is the agent aiming wrong, not a fault of the app: soft, like a refused ref.
      await recordAction("ui_get_page_state", undefined, result.ok, result.ok ? undefined : result.error, within !== undefined);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Failed to get page state" }] };
      }
      return { content: [{ type: "text", text: format === "full" ? JSON.stringify(result) : renderCompact(result) }] };
    }
  );

  registerSessionTool(
    TOOL.getText,
    {
      title: TOOL.getText,
      description:
        "Read the trimmed visible text of the one element matching `selector`, or of the whole body without one (cut at 4000 characters, with a note of the real length). " +
        "Use it to check content: a table value, a heading, an error under a field, a total. Fails if the selector matches no element, several, or an invisible one.",
      inputSchema: {
        selector: z.string().optional().describe(SELECTOR_DESCRIPTION + "; omit for the whole body"),
      },
    },
    async ({ selector: rawSelector }) => {
      let text = "";
      const selector = textSelectorOrUndefined(rawSelector);
      return runInteraction(
        TOOL.getText,
        selector === undefined ? {} : { selector },
        async (target) => {
          const result = await getText(target, selector);
          text = result.text ?? "";
          return result;
        },
        () => text || "(no visible text)"
      );
    }
  );

  registerSessionTool(
    "ui_take_screenshot",
    {
      title: "ui_take_screenshot",
      description:
        "Save a PNG of the viewport to the reports folder; `selector` captures just that element, `fullPage` the whole scrollable page (cut at 16000 px tall, 3840 wide). " +
        `\`inline: true\` also returns the image in the reply, scaled to fit ${MAX_INLINE_WIDTH}x${MAX_INLINE_HEIGHT}px (the saved file stays full size).`,
      inputSchema: {
        selector: z.string().optional().describe(SELECTOR_DESCRIPTION + "; not with fullPage"),
        fullPage: z.boolean().optional(),
        inline: z.boolean().optional(),
      },
    },
    async ({ selector, fullPage, inline }) => {
      const result = await takeScreenshot(resolvePageForRead(), REPORTS_DIR, { selector, fullPage, inline });
      await recordAction(
        "ui_take_screenshot",
        result.ok
          ? { path: result.path, ...(selector !== undefined && { selector }), ...(fullPage && { fullPage }) }
          : undefined,
        result.ok,
        result.ok ? undefined : result.error
      );
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Screenshot failed" }] };
      }
      const text = `Screenshot saved to ${result.path}${result.note ? `. ${result.note}` : ""}`;
      return {
        content: [
          { type: "text", text },
          ...(result.imageBase64 ? [{ type: "image" as const, data: result.imageBase64, mimeType: "image/png" }] : []),
        ],
      };
    }
  );

  return server;
}

// One MCP session per browser-side connection, keyed by mcp-session-id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport!;
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) delete transports[transport!.sessionId];
    };
    const mcpServer = buildMcpServer();
    await mcpServer.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing mcp-session-id");
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing mcp-session-id");
    return;
  }
  await transport.handleRequest(req, res);
});

// /health must stay responsive even while a navigation is in progress —
// it does not touch the browser/page state (Edge Case Checklist).
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Thin REST wrapper for non-MCP callers (T004) — reuses the same
// session/tool/report primitives as the MCP tools above.
app.post("/api/run-test", handleRunTest);

// src/stdio.ts sets EASY_UI_MCP_NO_HTTP before importing this module: no port, no SIGTERM handler.
if (!process.env.EASY_UI_MCP_NO_HTTP) {
  app.listen(PORT, () => {
    console.log(`easy-ui-mcp server listening on http://localhost:${PORT}`);
  });

  process.on("SIGTERM", async () => {
    await closeBrowser();
    process.exit(0);
  });
}
