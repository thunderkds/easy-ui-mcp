// MCP server entrypoint: HTTP/SSE transport + /health route + ui_navigate tool.
// Tracer-bullet slice (T001) — see tasks/TASK_GUIDE_T001.md.
//
// Transport spike (2026-07-01): confirmed the MCP SDK's StreamableHTTPServerTransport
// runs cleanly inside a single long-lived Express process (session-per-connection via
// the mcp-session-id header), with /health remaining independently responsive. No
// workaround needed. See memory/decisions.md for the full spike record.

import express from "express";
import { randomUUID } from "node:crypto";
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
  getPageState,
  takeScreenshot,
} from "./tools/web.js";
import {
  startSession,
  endSession,
  getSessionPage,
  logAction,
  markFailed,
  type LoggedAction,
} from "./tools/session.js";
import { writeReports } from "./reports/index.js";
import { handleRunTest } from "./api/run-test.js";

const PORT = 8765;
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
  }
  return page;
}

/** Returns the current page without creating one (undefined if ui_navigate hasn't run yet). */
function currentPage(): Page | undefined {
  return page && !page.isClosed() ? page : undefined;
}

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
   * active). On the first failing step, marks the session failed and
   * captures a screenshot for the report (NFR-007).
   */
  async function recordAction(
    name: string,
    args: Record<string, unknown> | undefined,
    ok: boolean,
    detail?: string
  ): Promise<void> {
    if (!activeSessionId) return;
    const entry: LoggedAction = { timestamp: new Date().toISOString(), action: name, args, ok, detail };
    logAction(activeSessionId, entry);
    if (!ok) {
      const sessionPage = getSessionPage(activeSessionId);
      const shot = await takeScreenshot(sessionPage, REPORTS_DIR);
      markFailed(activeSessionId, shot.ok ? shot.path : undefined);
    }
  }

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
      description: "Click the single element matching the given selector.",
      inputSchema: { selector: z.string().describe("CSS selector of the element to click") },
    },
    async ({ selector }) => {
      const target = resolvePageForRead();
      if (!target) {
        await recordAction("ui_click", { selector }, false, "No active page");
        return { isError: true, content: [{ type: "text", text: "No active page — call ui_navigate first" }] };
      }
      const result = await click(target, selector);
      await recordAction("ui_click", { selector }, result.ok, result.error);
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: result.error ?? "Click failed" }] };
      }
      return { content: [{ type: "text", text: `Clicked "${selector}"` }] };
    }
  );

  server.registerTool(
    "ui_fill",
    {
      title: "ui_fill",
      description: "Fill the single input element matching the given selector with a value.",
      inputSchema: {
        selector: z.string().describe("CSS selector of the input element to fill"),
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
    "ui_assert",
    {
      title: "ui_assert",
      description: "Evaluate a JS expression against the current page and return pass/fail.",
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
    "ui_get_page_state",
    {
      title: "ui_get_page_state",
      description: "Return the current page's URL, title, and visible interactive elements.",
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
