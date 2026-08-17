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

`ui_start_session`, `ui_end_session`, `ui_step`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_get_page_state`, `ui_take_screenshot` — plus a REST wrapper at `POST /api/run-test` for non-MCP callers.

### Label your steps

`ui_step(label)` groups everything that follows it under a plain-language heading, until the next `ui_step`. The label is **the only human-readable description the report has** — the server never invents prose (no LLM runs inside the container), so an unlabelled session renders as a list of selectors and conditions.

```
ui_start_session  target: "Account Access toggle smoke"
ui_step           label:  "Open the Settings page"
ui_navigate       ...
ui_wait_for       ...
ui_step           label:  "Turn Manual Invoice access on"
ui_click          ...
ui_assert         ...
ui_end_session
```

Sessions with no `ui_step` calls still render correctly, under a single implicit group.

### Verifying vs waiting — pick the right one

A session is marked `failed` if any hard action fails, so *how* you verify decides whether the report tells the truth.

| Tool | Condition false means | Use it for |
|------|----------------------|------------|
| `ui_assert` | **The session fails.** | A claim about the app: "the toggle is now on" |
| `ui_check` | Recorded and shown, run continues | An observation you want in the report but which should not condemn the run |
| `ui_wait_for` | Keeps polling; **timing out fails the session** | Waiting for the page to render or settle |

Never call `ui_assert` in a retry loop to wait for something — the first false result permanently fails the run even if the app is fine. That is what `ui_wait_for` is for.

For both `ui_check` and `ui_wait_for`, a condition that cannot *run* (no page open, or the expression throws) is always a hard failure: that is a harness error, not an observation.

Auto-failure screenshots are budgeted per session (`FAILURE_SCREENSHOT_BUDGET`, default 3). Identical screenshot content is embedded in the HTML report only once.

### What the report shows

A verdict box (status, target, step/action/failure counts, duration), then the run as labelled steps with per-step outcomes and elapsed time, then any browser problems, and finally the raw action log collapsed behind a disclosure.

Console errors, uncaught page errors, and failed requests are captured automatically and listed under **Browser problems** — a flow that passes while the console throws is a false green worth seeing. They are informational and never change the verdict. Up to 50 are retained per session; past that the report says the rest were dropped.

See [AGENTS.md](AGENTS.md) for the architecture and full MCP connection guide, and [HARNESS.md](HARNESS.md) for the REST API reference. Deploy/rollback procedures are in [RUNBOOK.md](RUNBOOK.md).

## Scope (v1)

Web only (Chromium), local only, no mobile support yet. See [PRD.md](PRD.md) for full product intent and [PROJECT_SPEC.md](PROJECT_SPEC.md) for architecture decisions.
