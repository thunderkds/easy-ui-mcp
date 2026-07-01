# AGENTS.md — Extending easy-ui-mcp

This document explains how a future agent (human developer or AI coding assistant) can connect to and extend this project.

---

## Quick Start: What This Project Does

**easy-ui-mcp** is a Dockerized MCP server that exposes browser automation tools over HTTP/SSE. You run it locally:

```bash
docker-compose up -d
```

Then connect an MCP client (like Claude Code) to automate web UI testing without writing test scripts. The server logs every action and generates a pass/fail HTML report with embedded screenshots.

---

## Architecture: Primitive Tools + Session Bracketing

This project uses a **Option A** architecture (see `BRAINSTORMING_LOG.md`):

- **No server-side LLM calls** — the container has no API keys or LLM reasoning. Instead, **Claude Code (or another agent) calls primitive Playwright tools step-by-step** and decides what to do next.
- **Session bracketing** — every test run is wrapped in `ui_start_session(target)` and `ui_end_session()`. All tool calls between these two are logged into a single report (JSON + HTML).
- **Primitive tools only** — the server exposes 8 tools:
  - `ui_start_session(target)` — Open a fresh browser context, label this test run
  - `ui_end_session()` — Close the context, write reports (JSON + HTML with screenshots)
  - `ui_navigate(url)` — Go to a URL
  - `ui_click(selector)` — Click a CSS-selectable element
  - `ui_fill(selector, value)` — Fill an input field
  - `ui_assert(condition)` — Evaluate a JavaScript expression (pass/fail)
  - `ui_get_page_state()` — Return URL, title, and visible elements (DOM state)
  - `ui_take_screenshot()` — Capture viewport as PNG

---

## Critical Constraints (Do Not Violate)

1. **No server-side LLM** — No API keys, no `gpt-4`, no prompt chaining inside the container.
2. **Chromium only (v1)** — Firefox/WebKit are deferred to v2. The tool interface is designed to add them later without changing the API.
3. **Web testing only (v1)** — Mobile (Appium/Maestro) is entirely out of scope for v1. No stub file exists yet; a v2 implementation would start from scratch in a new `src/tools/mobile.ts`.
4. **HTTP/SSE transport** — The MCP server communicates over HTTP on `localhost:8765`, not stdio. This allows the container to stay running while you call it from Claude Code.
5. **Docker base image fixed** — Use `mcr.microsoft.com/playwright:v1.61.1-jammy` (must match `playwright` npm version in `package.json`). Do not hand-roll browser install scripts.

---

## How to Connect Claude Code

### 1. Start the Server

```bash
cd /path/to/easy-ui-mcp
docker-compose up -d --build
```

Verify readiness:
```bash
curl http://localhost:8765/health
# Expected: {"status":"ok"}
```

### 2. Add the MCP Server to Claude Code

Run this from a terminal in your project:

```bash
claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp
```

This writes an entry to `.mcp.json`:

```json
{
  "mcpServers": {
    "easy-ui-mcp": {
      "type": "http",
      "url": "http://localhost:8765/mcp"
    }
  }
}
```

**Notes**:
- **url**: `http://localhost:8765/mcp` — the HTTP endpoint where the server listens for MCP requests
- Claude Code's Streamable HTTP transport handles the `mcp-session-id` header and the `Accept: application/json, text/event-stream` negotiation automatically — no manual header configuration needed

### 3. Test the Connection

In a Claude Code chat, ask it to call a tool:

```
Can you navigate to https://example.com and take a screenshot?
```

Claude Code should:
1. Call `ui_start_session("Navigate to example.com")`
2. Call `ui_navigate("https://example.com")`
3. Call `ui_take_screenshot()`
4. Call `ui_end_session()`
5. Show you the report path (in `reports/session-<UUID>.html` inside the container)

If you see tool calls succeed and a report path in the response, the connection is working.

---

## Understanding Session Reports

When `ui_end_session()` is called, the server generates two files in the `reports/` volume:

- **JSON report** — `session-<UUID>.json` — structured log of every action taken
- **HTML report** — `session-<UUID>.html` — human-readable report with embedded screenshots

Example JSON structure (from `src/reports/index.ts`):
```json
{
  "id": "...",
  "target": "Navigate to example.com",
  "status": "passed",
  "startedAt": "2026-07-01T...",
  "actions": [
    {
      "timestamp": "...",
      "action": "ui_navigate",
      "args": {"url": "https://example.com"},
      "ok": true,
      "detail": "https://example.com/"
    },
    {...}
  ],
  "endedAt": "2026-07-01T..."
}
```

The `ok` field in each action is `false` if the tool call failed. If any action fails, the session status is `failed` and the first failing step's screenshot is embedded in the report.

---

## How to Read / Modify the Code

| Directory | Purpose |
|-----------|---------|
| `src/server.ts` | Main entrypoint — MCP server setup, tool registration, session tracking |
| `src/tools/web.ts` | Playwright primitives (`navigate`, `click`, `fill`, etc.) |
| `src/tools/session.ts` | Session lifecycle (create, end, log actions) |
| `src/api/run-test.ts` | REST wrapper for `/api/run-test` endpoint (non-MCP callers) |
| `src/reports/index.ts` | JSON + HTML report generation |
| `Dockerfile` | Docker build: `mcr.microsoft.com/playwright`, `npm ci`, `npm run build`, `node dist/server.js` |
| `docker-compose.yml` | One service, port 8765, volume for reports/ |
| `.claude/` | Supervisor framework (agents, skills, memory) — do not modify |
| `tasks/` | Task guides (do not modify) |
| `memory/` | Supervisor memory (do not modify) |

---

## How to Extend This Project

### Adding a New Tool

1. Write the Playwright logic in `src/tools/web.ts` (or a new file in `src/tools/`).
2. Register the tool in `src/server.ts` — call `server.registerTool(...)` with:
   - Tool name (e.g., `"ui_scroll"`)
   - Description
   - Input schema (Zod validation)
   - Implementation function
3. Log the action via `recordAction(...)` so it appears in the session report.
4. Rebuild and restart: `docker-compose up -d --build`
5. Test: Ask Claude Code to call the new tool.

### Adding Multi-Browser Support (Firefox / WebKit)

1. Modify `src/tools/web.ts` to accept a `browser` parameter (defaults to Chromium).
2. Add a `ui_set_browser(browser)` tool (or embed in `ui_start_session`).
3. Update Dockerfile to include Firefox and WebKit (the base image supports this).
4. Test thoroughly — screenshot diffs and timing may vary between browsers.
5. Update `PROJECT_SPEC.md` Critical Constraints section (and this file) to reflect v2 scope.

### Adding Mobile Support (v2)

Appium + Maestro are deferred; start in `src/tools/mobile.ts`:
1. Decide on Appium vs. Maestro (or both).
2. Add a `platform` parameter to `ui_start_session` (currently web-only).
3. Route tool calls to either the web or mobile implementation.
4. Update Docker base image (may need a different image or manual setup).
5. Thoroughly test — mobile VNC and async device interaction are more complex.

---

## Debugging Tips

### Container logs
```bash
docker-compose logs -f easy-ui-mcp
```

### Check if reports are being generated
```bash
ls -la ./reports/
```

### Test MCP connection with curl (Protocol level)
```bash
curl -s -X POST http://localhost:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: test-1" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {"sampling": {}},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    }
  }'
```

Expected response (server-sent event format):
```
event: message
data: {"result":{...},"jsonrpc":"2.0","id":1}
```

### Stop and clean up
```bash
docker-compose down
docker image prune -f  # optional: clean up old images
```

---

## Summary for Future Agents

- **Start the server**: `docker-compose up -d`
- **Connect Claude Code**: Add the MCP server config (see above) with session-per-connection.
- **Test a flow**: Ask Claude Code to navigate and take a screenshot — it will call tools and report back.
- **Read the code**: `src/server.ts` is the hub; tool implementations are in `src/tools/`.
- **No LLM inside the container** — all reasoning happens in Claude Code (or your agent).
- **v2 deferred**: Firefox/WebKit and mobile (Appium/Maestro) are explicitly deferred.

See `PROJECT_SPEC.md` for architecture decisions and `PRD.md` for product intent.
