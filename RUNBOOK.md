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
| MCP tool discovery | `tools/list` JSON-RPC call to `/mcp` | Response lists all 8 tools (`ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`, `ui_start_session`, `ui_end_session`) |
| REST smoke check | `POST /api/run-test` with a valid `app_url_or_package` | HTTP 200, `status: "passed"`, `report_url` points to a real file |

- **Dashboards**: none (local-only tool) — check `docker compose logs -f easy-ui-mcp` for live logs.

---

## Common Failure Modes & Remediation

| Symptom | Likely cause | Remediation |
|---------|-------------|-------------|
| `docker compose up` fails with "port is already allocated" | A stale container from a previous session/worktree still holds port 8765 | `docker ps -a \| grep 8765`, then `docker stop <id> && docker rm <id>` before retrying |
| `docker compose up -d` succeeds but `PORTS` column is empty in `docker compose ps` | Observed transient Docker Compose quirk in this environment | `docker compose down` then `docker compose up -d` again (full cycle, not just `up`) |
| `npm test` appears to hang indefinitely | Sandbox-specific `node:test` multi-file process-isolation quirk, not a code bug (see `memory/learnings.md`) | Kill the process, verify the live endpoint directly via `curl`, then run test files individually: `node --import tsx --test test/<file>.test.ts` |
| Malformed JSON POST to `/mcp` returns a raw stack trace | Missing JSON-parse error handler (fixed in T001, watch for regression if `src/server.ts`'s middleware order changes) | Confirm the JSON-parse error middleware is registered immediately after `express.json()` |

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
