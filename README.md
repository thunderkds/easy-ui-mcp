# EASY UI MCP

**Not just another browser controller — a local UI-testing MCP that gives your agent structured, shareable test reports.**

easy-ui-mcp is a Dockerized MCP (Model Context Protocol) server for local UI testing. It exposes Playwright-based browser tools over HTTP/SSE so an AI agent (like Claude Code) can drive web UI flows step-by-step and get back a JSON + HTML report with screenshots — no server-side LLM, no test scripts to write.

The detailed guide is on the [docs page](https://easy-ui-mcp.vercel.app/) (source: [`site/index.html`](site/index.html), plain static files on Vercel).

## The problem

General browser automation answers "can the agent click this?". Testing asks "did the flow work, and where is the proof?". A transcript of clicks is not proof: it has no verdict, no screenshots, and no list of the console errors and failed requests that happened along the way.

## Why use it

| What you get | How it works |
|---|---|
| **A report for every session** | A JSON file and a self-contained HTML report: screenshots, step labels, pass/fail, the action log. See [What the report shows](https://easy-ui-mcp.vercel.app/#reports). |
| **Primitives made for testing** | `ui_step` names each stage; `ui_assert`, `ui_check` and `ui_wait_for` are three different tools on purpose. |
| **A verdict you can trust** | A hard failure fails the session; a soft `ui_check` does not. Console errors, page errors, failed requests and HTTP 4xx/5xx are listed under **Browser problems**. |
| **Local-first, one command** | `docker compose up -d --build`. No cloud account, no API key, nothing leaves your machine. |
| **No LLM inside the server** | The server only runs tools and records the result. The agent does the reasoning. |
| **Made for Claude Code** | One `claude mcp add` over HTTP/SSE, up to 3 sessions side by side per connection, and a stdio entry for hosts that wrap stdio servers. |
| **Fewer wasted calls** | `ui_get_page_state` returns one short line per element with a ref checked against the live page; native dialogs are held open for the agent to answer. |

Report size was measured too: a soft-check run went from 357 KB to about 4 KB once soft failures stopped capturing a full-screen PNG. See [Measured](https://easy-ui-mcp.vercel.app/#measured).

## Quick Start

```bash
docker compose up -d --build
curl http://localhost:8765/health
# {"status":"ok"}
claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp
```

Then ask Claude Code to navigate to a page and take a screenshot. Using it from another repo? Run `claude mcp add` from that repo's root too ([guide](https://easy-ui-mcp.vercel.app/#another-repo)).

Tools: `ui_start_session`, `ui_end_session`, `ui_step`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_set_viewport`, `ui_type`, `ui_navigate_history`, `ui_click_outside`, `ui_dialog`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_get_page_state`, `ui_get_text`, `ui_get_logs`, `ui_tabs`, `ui_upload_file`, `ui_drag`, `ui_take_screenshot` — plus a REST wrapper at `POST /api/run-test`. Details: [Tools](https://easy-ui-mcp.vercel.app/#tools). With several open sessions, pass `session_id` to pick one ([Several sessions](https://easy-ui-mcp.vercel.app/#several-sessions)).

Over stdio (Glama, `mcp-proxy`): build, then `mcp-proxy -- node dist/stdio.js`. See [Running over stdio](https://easy-ui-mcp.vercel.app/#stdio).

## More

[Networking](https://easy-ui-mcp.vercel.app/#networking) and [Scope (v1)](https://easy-ui-mcp.vercel.app/#scope) are on the docs page. Also: [AGENTS.md](AGENTS.md) (architecture, full MCP connection guide), [HARNESS.md](HARNESS.md) (REST API), [RUNBOOK.md](RUNBOOK.md) (deploy and rollback), [PRD.md](PRD.md) (product intent).
