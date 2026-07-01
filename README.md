# easy-ui-mcp

A Dockerized MCP (Model Context Protocol) server for local UI testing. It exposes Playwright-based browser automation tools over HTTP/SSE so an AI agent (like Claude Code) can drive web UI flows step-by-step and get back a JSON + HTML report with screenshots — no server-side LLM, no test scripts to write.

## Quick Start

```bash
docker compose up -d --build
curl http://localhost:8765/health
# {"status":"ok"}
```

Connect Claude Code:

```bash
claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp
```

Then ask Claude Code to navigate to a page and take a screenshot — it will call the tools below and report back.

## Tools

`ui_start_session`, `ui_end_session`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot` — plus a REST wrapper at `POST /api/run-test` for non-MCP callers.

See [AGENTS.md](AGENTS.md) for the architecture and full MCP connection guide, and [HARNESS.md](HARNESS.md) for the REST API reference. Deploy/rollback procedures are in [RUNBOOK.md](RUNBOOK.md).

## Scope (v1)

Web only (Chromium), local only, no mobile support yet. See [PRD.md](PRD.md) for full product intent and [PROJECT_SPEC.md](PROJECT_SPEC.md) for architecture decisions.
