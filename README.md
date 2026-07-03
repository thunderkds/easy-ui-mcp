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

**Using this from another repo?** MCP registration is per-project — run `claude mcp add` from that repo's root too (the container above only needs to run once, shared across repos). See [AGENTS.md → Using easy-ui-mcp From Another Repo](AGENTS.md#using-easy-ui-mcp-from-another-repo) for the full required steps.

## Networking

The container runs with `network_mode: host` in `docker-compose.yml` (not a published port on a bridge
network). This is required, not optional: the browser Playwright drives inside this container needs to
reach `localhost:<port>` on **your host machine**, where the target app's dev server (the repo you're
testing) is actually running. A default bridge network gives the container its own isolated network
namespace with no route back to the host at all — target URLs like `http://localhost:8766` will hang or
fail with `ERR_CONNECTION_REFUSED`, and `http://<host-LAN-IP>:8766` will just time out, even if the target
server is listening and reachable via `curl` from the host shell.

If you fork/redeploy this container anywhere `network_mode: host` isn't available (e.g. Docker Desktop on
macOS/Windows, where host networking support is limited or absent), use `host.docker.internal` as the
target hostname instead of `localhost` when calling `ui_navigate`, and add a `network_mode: host` fallback
of `extra_hosts: ["host.docker.internal:host-gateway"]` to `docker-compose.yml`.

## Tools

`ui_start_session`, `ui_end_session`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot` — plus a REST wrapper at `POST /api/run-test` for non-MCP callers.

See [AGENTS.md](AGENTS.md) for the architecture and full MCP connection guide, and [HARNESS.md](HARNESS.md) for the REST API reference. Deploy/rollback procedures are in [RUNBOOK.md](RUNBOOK.md).

## Scope (v1)

Web only (Chromium), local only, no mobile support yet. See [PRD.md](PRD.md) for full product intent and [PROJECT_SPEC.md](PROJECT_SPEC.md) for architecture decisions.
