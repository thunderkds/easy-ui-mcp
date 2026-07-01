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

// Single shared browser/page for this tracer-bullet slice. Session lifecycle
// (ui_start_session/ui_end_session, per-session browser contexts) is T003 scope.
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

  server.registerTool(
    "ui_navigate",
    {
      title: "ui_navigate",
      description: "Navigate the browser to the given URL and report the result.",
      inputSchema: { url: z.string().describe("The URL to navigate to") },
    },
    async ({ url }) => {
      const target = await getPage();
      const result = await navigate(target, url);
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
      const target = await getPage();
      const result = await click(target, selector);
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
      const target = await getPage();
      const result = await fill(target, selector, value);
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
      const result = await assertCondition(currentPage(), condition);
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
      const result = await getPageState(currentPage());
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
      const result = await takeScreenshot(currentPage(), REPORTS_DIR);
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

app.listen(PORT, () => {
  console.log(`easy-ui-mcp server listening on http://localhost:${PORT}`);
});

process.on("SIGTERM", async () => {
  if (browser) await browser.close();
  process.exit(0);
});
