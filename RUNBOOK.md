# RUNBOOK — easy-ui-mcp (UI Testing MCP Server)
**Last updated**: 2026-07-01

> Operational runbook: how to deploy, verify, and recover this service. Written/appended by the `ship` skill after Stage 5 verification, and kept current by whoever last touched the deploy path. This is the document an operator opens at 3am — every command must be copy-pasteable and every check must have a pass condition.

---

## Service Identity

- **Name**: easy-ui-mcp (UI Testing MCP Server)
- **Repo**: `git@github.com:thunderkds/easy-ui-mcp.git`
- **Deployment target**: Local only — `docker-compose up -d`, `localhost:8765`
- **Tech**: TypeScript + Node.js, Playwright, Docker (mcr.microsoft.com/playwright base image)
- **Owner / on-call**: hungnh1110 (solo developer)

---

## Deploy Procedure

Ordered steps to ship a release. Commands copy-pasteable.

1. **Pre-deploy checks**: `git status` clean, on `main`, Stage 5 evidence green for every in-scope task, `origin/main` up to date (`git push origin main` if not).
2. `docker compose down` — clear any stale container holding port 8765.
3. `docker compose up -d --build` — rebuild and start the container.
4. **Post-deploy health check**: `curl -fsS http://localhost:8765/health` → pass condition: HTTP 200, body `{"status":"ok"}`.
5. **Smoke the MCP path**: `claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp`, then ask Claude Code to navigate to a URL and take a screenshot — confirm a report appears in `./reports/`.

> If the deploy command changes (e.g. a future remote/cloud target), update this file and `PROJECT_SPEC.md`'s Deployment target together.

---

## Rollback Procedure

- **Trigger conditions**: health check fails post-deploy; MCP tool calls error or hang; container fails to start; a REST/MCP smoke test regresses.
- **Reverse steps** (in order):
  1. `docker compose down`
  2. If a bad commit was just deployed: `git revert <bad-commit>` on `main`, push, then re-run the Deploy Procedure above.
  3. There is no prior deployed version before v0.1.0 — for this release, rollback simply means stopping the container until the issue is fixed.
- **Verify rollback**: `docker ps` shows no `easy-ui-mcp` container running.

---

## Health Checks & Dashboards

| Check | Command / URL | Pass condition |
|-------|---------------|----------------|
| Liveness | `curl -fsS http://localhost:8765/health` | HTTP 200, `{"status":"ok"}` |
| MCP tool discovery | `tools/list` JSON-RPC call to `/mcp` | Response lists all 26 tools (`ui_start_session`, `ui_end_session`, `ui_step`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_set_viewport`, `ui_type`, `ui_navigate_history`, `ui_click_outside`, `ui_dialog`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_get_page_state`, `ui_get_text`, `ui_get_logs`, `ui_tabs`, `ui_upload_file`, `ui_drag`, `ui_take_screenshot`) |
| REST smoke check | `POST /api/run-test` with a valid `app_url_or_package` | HTTP 200, `status: "passed"`; `report_url` is a container path whose basename exists under the host's mounted `./reports/` directory |

- **Dashboards**: none (local-only tool) — check `docker compose logs -f easy-ui-mcp` for live logs.

---

## Configuration

Environment variables the server reads (`docker-compose.yml` sets none today; add them under an `environment:` key of the `easy-ui-mcp` service, then `docker compose up -d`). All are optional.

| Variable | Default | Meaning |
|----------|---------|---------|
| `SESSION_TIMEOUT_MS` | `600000` (10 min) | A session with no tool call for this long is closed and its report written with status `timed_out`. |
| `MAX_SESSIONS_PER_CONNECTION` | `3` | Open sessions one MCP connection may hold. `ui_start_session` past it is refused with "Session limit reached". |
| `DIALOG_TIMEOUT_MS` | `120000` (2 min) | How long a native dialog is held for `ui_dialog` before it is dismissed automatically (a positive number; anything else falls back to the default). Read per dialog, so no restart is needed for a test. |
| `FAILURE_SCREENSHOT_BUDGET` | `3` | Auto-failure screenshots taken per session. |

---

## Common Failure Modes & Remediation

| Symptom | Likely cause | Remediation |
|---------|-------------|-------------|
| `docker compose up` fails with "port is already allocated" | A stale container from a previous session/worktree still holds port 8765 | `docker ps -a \| grep 8765`, then `docker stop <id> && docker rm <id>` before retrying |
| `docker compose up -d` succeeds but `PORTS` column is empty in `docker compose ps` | Observed transient Docker Compose quirk in this environment | `docker compose down` then `docker compose up -d` again (full cycle, not just `up`) |
| `npm test` appears to hang or fails with `EADDRINUSE` | Port 8765 is held (usually by the running Docker container): two test files start their own server on that hard-coded port | `docker compose stop`, run `npm test`, then `docker compose up -d`. A single file can be run alone: `node --import tsx --test test/<file>.test.ts` |
| Malformed JSON POST to `/mcp` returns a raw stack trace | Missing JSON-parse error handler (fixed in T001, watch for regression if `src/server.ts`'s middleware order changes) | Confirm the JSON-parse error middleware is registered immediately after `express.json()` |
| MCP calls refused with "A confirm dialog is waiting: \"...\" — answer it with ui_dialog first" (or "An alert dialog", prompt, beforeunload) | A native browser dialog opened and is held for the agent to answer; every other tool is refused until it is | Call `ui_dialog` with `accept` or `dismiss` (add `text` for a prompt). An unanswered dialog is dismissed after `DIALOG_TIMEOUT_MS` (default 120000) |
| A tool call fails with "Ref @e3 is stale" or "Ref @e3 is not in the latest snapshot" | The agent used an `@eN` / `@oN` ref after the page changed, from another session or tab, before any `ui_get_page_state`, or after a `format: "full"` snapshot (which lists no refs and ends the earlier ones). The call is refused on purpose and nothing was clicked or typed; the report lists it as a soft step and the session verdict is not affected | Call `ui_get_page_state` again and use the refs it lists. `ui_get_page_state` replies in compact text by default; `format: "full"` returns the JSON with selectors, which need no refs |
| `ui_get_page_state` replies with a note "The page was still changing while it was read, so this list may be incomplete: call ui_get_page_state again" | The page kept replacing the elements it lists (a client-side route change, or a script that re-renders on a timer) for about 2 seconds, so the snapshot never got a stable pass. Each pass that sees a listed element leave the document is repeated after 100 ms, up to a 2-second budget; the last pass is returned with this note | Call `ui_get_page_state` again once the page has settled. If it never does, the page re-renders continuously: `ui_wait_for` a stable element first, or use a CSS selector |
| `ui_start_session` fails with "Session limit reached" | The connection already holds `MAX_SESSIONS_PER_CONNECTION` (default 3) open sessions | `ui_end_session` with a `session_id` to free one, or raise `MAX_SESSIONS_PER_CONNECTION` and recreate the container |
| `reports/downloads/` keeps growing | Pages under test trigger downloads; each session saves into `reports/downloads/<session>/` | Each session keeps at most 20 downloads of 25 MB each and discards the rest, but nothing deletes old sessions' files: remove old `reports/downloads/<session>/` folders by hand |

---

## On-Call / Escalation

1. **First responder**: hungnh1110 (solo developer — no rotation)
2. **Escalate to**: N/A (personal project)
3. **Comms**: N/A (local tool, no external users)

---

## Release Log

| Version / Tag | Date | Scope (Task IDs) | Deployer | Outcome |
|---------------|------|------------------|----------|---------|
| v0.1.0 | 2026-07-01 | T001, T002, T003, T004, T005 | hungnh1110 (via Supervisor) | Planned — GO, awaiting operator execution |
| main @ 4de8561 | 2026-11-10 | T029, T030, T031, T032, T033, T034 | hungnh1110 (via Supervisor) | Merged + pushed; container rebuild not yet verified |
