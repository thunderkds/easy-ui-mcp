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
import { z } from "zod";
import path from "node:path";
import {
  navigate,
  click,
  fill,
  assertCondition,
  classifyCheckOutcome,
  waitForCondition,
  getPageState,
  takeScreenshot,
  selectOption,
  pressKey,
  hover,
  setChecked,
  scroll,
  clickOutside,
  describeClick,
  MAX_WAIT_MS,
  type ClickOptions,
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
  attachDialogHandler,
  raceDialog,
  answerDialog,
  waitingDialogText,
  takeDialogNotices,
  type DialogCall,
  type LoggedAction,
} from "./tools/session.js";
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
  clickOutside: "ui_click_outside",
  dialog: "ui_dialog",
} as const;

const SELECTOR_DESCRIPTION =
  "CSS selector, or the `selector` value of an element from ui_get_page_state, passed unchanged";
const NTH_NOTE =
  ' Selectors containing "nth=" are positional: call ui_get_page_state again after the page changes before reusing them.';
const REPORTS_DIR = path.join(process.cwd(), "reports");

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

/** Returns the current page without creating one (undefined if ui_navigate hasn't run yet). */
function currentPage(): Page | undefined {
  return page && !page.isClosed() ? page : undefined;
}

/** Which running tool call a native dialog may take over (T031); read by recordAction. */
const callContext = new AsyncLocalStorage<DialogCall>();

type ToolResponse = { isError?: boolean; content: Array<{ type: "text"; text: string }> };

/** Tools that never refuse and never race a dialog: they are the way out of one, or never touch the page. */
const DIALOG_EXEMPT_TOOLS = new Set(["ui_start_session", "ui_end_session", "ui_step", TOOL.dialog]);
/** Tools that may create the legacy page, so the dialog listener must exist before they run. */
const PAGE_CREATING_TOOLS = new Set(["ui_navigate"]);

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "easy-ui-mcp", version: "0.1.0" });

  // At most one ui_session bracket active per MCP connection at a time.
  let activeSessionId: string | undefined;

  /** Resolves the page primitive tools should act on: the active session's
   * page if a session bracket is open, otherwise the legacy shared page. */
  async function resolvePageForWrite(): Promise<Page> {
    if (activeSessionId) {
      const sessionPage = getSessionPage(activeSessionId);
      if (sessionPage) return sessionPage;
    }
    return getPage();
  }

  function resolvePageForRead(): Page | undefined {
    if (activeSessionId) {
      return getSessionPage(activeSessionId);
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
    if (!activeSessionId) return;
    // A call a native dialog took over (T031) hits its own timeout while the page is
    // blocked, so a failure here says nothing about the app: keep it, but do not fail the run.
    if (!ok && !soft && callContext.getStore()?.abandoned) {
      soft = true;
      detail = `Interrupted by a native dialog; outcome unknown (${detail ?? "no detail"})`;
    }
    const entry: LoggedAction = { timestamp: new Date().toISOString(), action: name, args, ok, detail };
    if (soft) entry.soft = true;
    const step = getCurrentStep(activeSessionId);
    if (step) entry.step = step;
    logAction(activeSessionId, entry);
    if (!isFatalOutcome(entry)) return;

    if (claimFailureScreenshot(activeSessionId)) {
      const sessionPage = getSessionPage(activeSessionId);
      const shot = await takeScreenshot(sessionPage, REPORTS_DIR);
      markFailed(activeSessionId, shot.ok ? shot.path : undefined);
      return;
    }
    markFailed(activeSessionId);
  }

  /**
   * Shared body of the T019 interaction tools, identical in shape to ui_click:
   * fail clearly with no active page, run the action, record it (a failure is hard),
   * and answer with `isError` on failure.
   */
  async function runInteraction(
    name: string,
    args: Record<string, unknown>,
    act: (target: Page) => Promise<{ ok: boolean; error?: string }>,
    successText: string
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
    return { content: [{ type: "text" as const, text: successText }] };
  }

  /**
   * Every tool goes through this (T031, decision D1): a native dialog blocks the page, so
   * while one is waiting every tool but the exempt ones is refused, and a call that opens
   * one returns at once with "waiting" instead of hanging until its own timeout. The
   * abandoned call keeps running; ui_dialog collects its result. Notices (e.g. a dialog the
   * safety timeout dismissed) ride on the next response.
   */
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    handler: (args: unknown) => Promise<ToolResponse>
  ) => unknown;
  (server as unknown as { registerTool: typeof registerTool }).registerTool = (name, config, handler) =>
    registerTool(name, config, async (args: unknown): Promise<ToolResponse> => {
      const target = PAGE_CREATING_TOOLS.has(name) ? await resolvePageForWrite() : resolvePageForRead();
      const withNotices = (res: ToolResponse): ToolResponse => {
        const notices = takeDialogNotices(target);
        return notices.length === 0
          ? res
          : { ...res, content: [...res.content, ...notices.map((text) => ({ type: "text" as const, text }))] };
      };
      if (DIALOG_EXEMPT_TOOLS.has(name)) return withNotices(await handler(args));

      const waiting = waitingDialogText(target);
      if (waiting) return { isError: true, content: [{ type: "text", text: waiting }] };

      const outcome = await raceDialog(target, (call) =>
        callContext.run(call, async () => {
          const res = await handler(args);
          if (!(call.abandoned && res.isError)) return res;
          const why = res.content.map((c) => c.text).join(" ");
          return {
            content: [
              {
                type: "text" as const,
                text: `The call was interrupted by a native dialog and its own outcome is unknown (${why}). Check the page with ui_get_page_state.`,
              },
            ],
          };
        })
      );
      if (outcome.kind === "waiting") return { content: [{ type: "text", text: outcome.text }] };
      return withNotices(outcome.value);
    });

  server.registerTool(
    "ui_start_session",
    {
      title: "ui_start_session",
      description: "Start a session bracket: opens a fresh browser context and begins logging subsequent primitive tool calls into a report.",
      inputSchema: { target: z.string().describe("Label/URL identifying what this session tests") },
    },
    async ({ target }) => {
      if (activeSessionId) {
        return {
          isError: true,
          content: [{ type: "text", text: "A session is already active — call ui_end_session first" }],
        };
      }
      const record = await startSession(target);
      activeSessionId = record.id;
      return {
        content: [{ type: "text", text: `Session ${record.id} started for target "${target}"` }],
      };
    }
  );

  server.registerTool(
    "ui_end_session",
    {
      title: "ui_end_session",
      description: "End the current session bracket: writes a JSON + HTML report and returns their paths.",
      inputSchema: {},
    },
    async () => {
      if (!activeSessionId) {
        return {
          isError: true,
          content: [{ type: "text", text: "No active session — call ui_start_session first" }],
        };
      }
      const id = activeSessionId;
      activeSessionId = undefined;
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

  server.registerTool(
    "ui_navigate",
    {
      title: "ui_navigate",
      description: "Navigate the browser to the given URL and report the result.",
      inputSchema: { url: z.string().describe("The URL to navigate to") },
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

  server.registerTool(
    "ui_click",
    {
      title: "ui_click",
      description:
        "Click the single element matching the given selector. The selector may be a CSS selector or the `selector` value from ui_get_page_state, passed unchanged." +
        ' Selectors containing "nth=" are positional: call ui_get_page_state again after the page changes before reusing them.' +
        " Optional: `button` (right/middle), `clickCount` 2 for a double-click, `modifiers` for Shift/Control-click, `position` for an offset inside the element, `force` to click through an element covering it." +
        " If the click opens a native alert/confirm/prompt, the reply says the browser is waiting: answer it with ui_dialog.",
      inputSchema: {
        selector: z
          .string()
          .describe("CSS selector, or the `selector` value of an element from ui_get_page_state"),
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default left); right fires contextmenu"),
        clickCount: z.number().int().min(1).max(3).optional().describe("2 = double-click, 3 = triple-click (default 1)"),
        modifiers: z
          .array(z.enum(["Alt", "Control", "Meta", "Shift", "ControlOrMeta"]))
          .optional()
          .describe("Keys held during the click, e.g. [\"Shift\"] for a range select"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe("Click this offset from the element's top-left corner, in CSS pixels (default: its centre)"),
        force: z
          .boolean()
          .optional()
          .describe("Skip the check that nothing covers the element (e.g. a transparent overlay); the click lands on whatever is on top"),
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
      const result = await click(target, selector, options);
      await recordAction("ui_click", args, result.ok, result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Click failed" }] };
      }
      return { content: [{ type: "text", text: describeClick(`"${selector}"`, options) }] };
    }
  );

  server.registerTool(
    TOOL.clickOutside,
    {
      title: TOOL.clickOutside,
      description:
        "Click just outside the single element matching the selector, the way a user closes a modal, drawer or popover by clicking its backdrop. Picks a point whose topmost element is not inside the target and not a control, and says what it hit. " +
        "Pass the dialog panel, not the backdrop. Fails if no safe point exists (the element fills the viewport): use ui_press_key with Escape then." +
        NTH_NOTE,
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION + " of the modal/panel to click outside of"),
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

  server.registerTool(
    TOOL.dialog,
    {
      title: TOOL.dialog,
      description:
        "Answer a native browser dialog (alert, confirm, prompt, beforeunload). When a tool call opens one, its reply says \"Browser is waiting on a <type> dialog\" and every other tool is refused until you answer here. " +
        "`accept` = OK / Leave; `dismiss` = Cancel / Stay; for a prompt add `text`. The reply also reports what the interrupted action did next. " +
        "With no dialog waiting, this pre-sets the answer for the NEXT dialog, which is then answered at once (one answer, used once). An unanswered dialog is dismissed after a safety timeout.",
      inputSchema: {
        action: z.enum(["accept", "dismiss"]).describe("accept = OK / Leave; dismiss = Cancel / Stay"),
        text: z.string().optional().describe("Text to enter into a prompt dialog (accept only)"),
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
      const lines = [`${action === "accept" ? "Accepted" : "Dismissed"} the ${answered.type} dialog "${answered.message}".`];
      const done = answered.result as ToolResponse | undefined;
      if (answered.stillRunning) {
        lines.push("The action that opened it is still running — check the page with ui_get_page_state.");
      } else if (done?.content) {
        lines.push(`The interrupted call then returned: ${done.content.map((c) => c.text).join(" ")}`);
      }
      return { content: [{ type: "text", text: lines.join(" ") }] };
    }
  );

  server.registerTool(
    "ui_fill",
    {
      title: "ui_fill",
      description:
        "Fill the single input element matching the given selector with a value. The selector may be a CSS selector or the `selector` value from ui_get_page_state, passed unchanged." +
        ' Selectors containing "nth=" are positional: call ui_get_page_state again after the page changes before reusing them.',
      inputSchema: {
        selector: z
          .string()
          .describe("CSS selector, or the `selector` value of an input element from ui_get_page_state"),
        value: z.string().describe("The value to fill into the input"),
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

  server.registerTool(
    TOOL.selectOption,
    {
      title: TOOL.selectOption,
      description:
        "Choose an option of the single <select> matching the selector, by option value or visible label. For a <select multiple> this selects exactly that one option. Use the `selector` from ui_get_page_state." +
        NTH_NOTE,
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        value: z.string().describe("The option's value attribute or its visible label"),
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

  server.registerTool(
    TOOL.pressKey,
    {
      title: TOOL.pressKey,
      description:
        "Press a key (Playwright key name such as Enter, Tab, Escape, ArrowDown, or a combo like Control+a). With `selector` it presses on that element; without, on whatever has focus. Enter in a text input submits its form." +
        NTH_NOTE,
      inputSchema: {
        key: z.string().describe("Playwright key name, e.g. Enter, Tab, Escape, ArrowDown"),
        selector: z.string().optional().describe(SELECTOR_DESCRIPTION + "; omit to press on the focused element"),
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

  server.registerTool(
    TOOL.hover,
    {
      title: TOOL.hover,
      description:
        "Move the pointer over the single element matching the selector, to reveal :hover or mouseenter content such as dropdown menus. Use the `selector` from ui_get_page_state." +
        NTH_NOTE,
      inputSchema: { selector: z.string().describe(SELECTOR_DESCRIPTION) },
    },
    async ({ selector }) =>
      runInteraction(TOOL.hover, { selector }, (target) => hover(target, selector), `Hovered over "${selector}"`)
  );

  server.registerTool(
    TOOL.setChecked,
    {
      title: TOOL.setChecked,
      description:
        "Set the single checkbox or radio button matching the selector to checked or unchecked. Idempotent: already in that state is fine. A radio cannot be unchecked directly. Use the `selector` from ui_get_page_state." +
        NTH_NOTE,
      inputSchema: {
        selector: z.string().describe(SELECTOR_DESCRIPTION),
        checked: z.boolean().describe("true to check, false to uncheck"),
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

  server.registerTool(
    TOOL.scroll,
    {
      title: TOOL.scroll,
      description:
        "Scroll the single element matching the selector into view; with no selector, scroll the page down by one viewport (call repeatedly to load lazy lists)." +
        NTH_NOTE,
      inputSchema: {
        selector: z.string().optional().describe(SELECTOR_DESCRIPTION + "; omit to scroll the page down one viewport"),
      },
    },
    async ({ selector }) =>
      runInteraction(
        TOOL.scroll,
        selector === undefined ? {} : { selector },
        (target) => scroll(target, selector),
        selector === undefined ? "Scrolled down one page" : `Scrolled "${selector}" into view`
      )
  );

  server.registerTool(
    "ui_assert",
    {
      title: "ui_assert",
      description:
        "Assert a JS expression against the current page. This is a HARD check: if it evaluates false the whole session is marked failed. " +
        "Use it only for claims about the application under test. To wait for the page to become ready use ui_wait_for, and for a " +
        "non-fatal observation use ui_check — do not call ui_assert in a retry loop, as the first false result permanently fails the run.",
      inputSchema: {
        condition: z.string().describe("JS expression evaluated in the page context"),
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

  server.registerTool(
    "ui_step",
    {
      title: "ui_step",
      description:
        "Label what you are about to do, in plain language. Every following action is grouped under this label in the report " +
        "until the next ui_step. Call it before each meaningful part of the flow (e.g. \"Log in as jcarlin\", " +
        "\"Toggle Manual Invoice access on\", \"Reload and confirm it persisted\") — this label is the only human-readable " +
        "description the report has, so write it for the person who will read the result, not for yourself.",
      inputSchema: {
        label: z.string().min(1).describe("Short description of what this step verifies or does"),
      },
    },
    async ({ label }) => {
      if (!activeSessionId) {
        return {
          isError: true,
          content: [{ type: "text", text: "No active session — call ui_start_session first" }],
        };
      }
      const trimmed = label.trim();
      if (trimmed === "") {
        return { isError: true, content: [{ type: "text", text: "Step label cannot be blank" }] };
      }
      setCurrentStep(activeSessionId, trimmed);
      await recordAction("ui_step", { label: trimmed }, true);
      return { content: [{ type: "text", text: `Step: ${trimmed}` }] };
    }
  );

  server.registerTool(
    "ui_check",
    {
      title: "ui_check",
      description:
        "Check a JS expression against the current page WITHOUT failing the session if it is false. " +
        "Use this for observations you want recorded in the report but which should not condemn the run. " +
        "If the expression cannot run at all (no page open, or it throws) that is still a hard failure.",
      inputSchema: {
        condition: z.string().describe("JS expression evaluated in the page context"),
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

  server.registerTool(
    "ui_wait_for",
    {
      title: "ui_wait_for",
      description:
        "Poll a JS expression until it becomes true or the timeout elapses. Use this to wait for the page to render " +
        "instead of retrying ui_assert. Returning true is recorded as one action; timing out fails the session.",
      inputSchema: {
        condition: z.string().describe("JS expression evaluated in the page context"),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(MAX_WAIT_MS)
          .default(5000)
          .describe(`How long to keep polling before giving up (max ${MAX_WAIT_MS}ms)`),
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

  server.registerTool(
    "ui_get_page_state",
    {
      title: "ui_get_page_state",
      description:
        "Return the current page's URL, title, visible interactive elements ({role, name, selector}; pass `selector` unchanged to ui_click/ui_fill, at most 200 elements) and visible alert/status messages.",
      inputSchema: {},
    },
    async () => {
      const result = await getPageState(resolvePageForRead());
      await recordAction("ui_get_page_state", undefined, result.ok, result.ok ? undefined : result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Failed to get page state" }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "ui_take_screenshot",
    {
      title: "ui_take_screenshot",
      description: "Capture the current viewport and save it as a PNG to the reports output.",
      inputSchema: {},
    },
    async () => {
      const result = await takeScreenshot(resolvePageForRead(), REPORTS_DIR);
      await recordAction(
        "ui_take_screenshot",
        result.ok ? { path: result.path } : undefined,
        result.ok,
        result.ok ? undefined : result.error
      );
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Screenshot failed" }] };
      }
      return { content: [{ type: "text", text: `Screenshot saved to ${result.path}` }] };
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

app.listen(PORT, () => {
  console.log(`easy-ui-mcp server listening on http://localhost:${PORT}`);
});

process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});
