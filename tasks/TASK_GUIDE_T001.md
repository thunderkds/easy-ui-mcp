# TASK_GUIDE — T001: Docker + MCP Server Skeleton + ui_navigate Tracer Bullet
**Date**: 2026-07-01
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: common-infrastructure
**Agent guide**: `.claude/agents/common-infrastructure.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/common-infrastructure.md`
5. Apply the C2 process (brainstorm/decompose/verify depth) from the Complexity matrix in `.claude/agents/general-agent-template.md`
6. This is a multi-file, C2 task — skim `memory/codebase-map.md` if it exists (it does not yet; this is the first code task, skip)

---

## Requirement (Pillar 1 — Adapt the requirement)

Create the initial Dockerized MCP server for the UI Testing MCP Server project. Build the smallest possible end-to-end vertical slice that proves the whole chain works: Docker container running, MCP server reachable over HTTP/SSE, one working primitive tool (`ui_navigate`), and Claude Code able to connect and successfully call it against a real page.

**Restated intent**:
> A developer runs `docker-compose up -d`, points Claude Code at the running MCP server, and Claude Code can call `ui_navigate(url)` and get back confirmation that a Chromium page loaded — proving the full Docker→MCP→Playwright→Claude Code chain works before any other tool is built.

**Out of scope**:
- All other primitive tools (`ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`) — T002
- Session lifecycle (`ui_start_session`/`ui_end_session`) and report generation — T003
- REST wrapper — T004
- Mobile support — deferred to v2 entirely

**Requirement Refs** (from `PRD.md`):
- FR-001: MCP server over HTTP/SSE on localhost:8765, backed by Docker container
- FR-006: starts fully via `docker-compose up -d`, no manual browser install steps
- FR-007: `/health` HTTP endpoint
- NFR-001: Claude Code must be able to connect via HTTP/SSE — verified working, not just documented
- NFR-002: single-command start on Docker Engine (no Docker Desktop dependency)
- NFR-003: runs on `localhost:8765`
- NFR-004: TypeScript + Node.js latest LTS
- NFR-006: Chromium only

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (Supervisor/user, not implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (primitive tools, session, MCP transport)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear, STOP and ask the Supervisor.

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `docker-compose up -d` starts the container with no manual steps and Chromium pre-installed | FR-006, NFR-002 |
| 2 | `GET http://localhost:8765/health` returns 200 with a readiness payload | FR-007 |
| 3 | MCP server is reachable over HTTP/SSE at `localhost:8765` and advertises a `ui_navigate` tool via MCP tool discovery | FR-001, NFR-003 |
| 4 | Claude Code, configured to connect to this server, successfully calls `ui_navigate(url)` against a real public page and receives a success response | NFR-001 |
| 5 | `ui_navigate` fails clearly (not a hang or crash) when given an unreachable URL | (edge case, ties to NFR-007 fail-fast, validated fully in T002) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | `docker-compose up -d` run from a clean checkout | Container reaches healthy state within a reasonable timeout | manual / automated health poll |
| 2 | `curl http://localhost:8765/health` | HTTP 200, JSON body indicating ready | automated test |
| 3 | Claude Code configured with this server's MCP connection, calls `ui_navigate` with `https://example.com` | Tool call succeeds, returns confirmation (e.g. page title or URL) | manual verification via `Skill({ skill: "verify" })` |
| 4 | `ui_navigate` called with an unreachable/malformed URL | Clear error returned, no hang, no container crash | automated test |

### Verification Command (exact, runnable)

```bash
docker-compose up -d && sleep 5 && curl -sf http://localhost:8765/health
```
(Claude Code MCP connectivity in Criterion 3 is verified manually per the `verify` skill — not automatable from a shell one-liner.)

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ✅ pass | `test/health.test.ts` (health + MCP initialize/tools-list), `test/web.test.ts` (navigate success, unreachable URL, malformed URL). 5/5 tests pass: "GET /health returns 200...", "MCP initialize handshake succeeds and advertises ui_navigate", "navigate succeeds on a reachable page", "navigate fails clearly on an unreachable URL", "navigate fails clearly on a malformed URL" |
| Verification command run | ✅ pass | `docker compose up -d && sleep 5 && curl -sf http://localhost:8765/health` → `{"status":"ok"}`. MCP handshake → session ID → `tools/call ui_navigate({url:"https://example.com"})` → `"Navigated to https://example.com/ (title: \"Example Domain\")"` |
| Negative cases hold | ✅ pass | `ui_navigate` on unreachable URL → `isError: true`, `"Navigation failed: page.goto: net::ERR_NAME_NOT_RESOLVED..."`, no hang, container stayed `Up` |
| verify | ✅ pass | Live MCP wire protocol drive (initialize→tools/list→tools/call) against rebuilt container. Found + fixed a stack-trace leak on malformed JSON (400 now returns clean `{"error":"Invalid JSON body"}`), re-verified full flow + 5/5 tests pass after fix. See verification report in conversation, 2026-07-01. |
| Review scope bounded to the change's blast radius | ✅ pass | Reviewed only T001's new files: `Dockerfile`, `docker-compose.yml`, `package.json`, `tsconfig.json`, `src/server.ts`, `src/tools/web.ts`, `test/*.test.ts` — no pre-existing code to check against (greenfield first task) |
| Full smoke suite still green (no regression) | ✅ pass | 5/5 tests pass after applying the `npm ci` fix; `docker compose build` clean |
| **UI: Visual regression** | ☐ N/A | No UI — backend/tooling task |
| **UI: Design-system compliance** | ☐ N/A | No UI — backend/tooling task |
| **UI: Responsiveness** | ☐ N/A | No UI — backend/tooling task |

---

## Approach

From `BRAINSTORMING_LOG.md` Option A: use the official `mcr.microsoft.com/playwright` Docker image (no manual browser install). Use the MCP SDK's built-in HTTP/SSE transport rather than a custom transport layer — **spike this first**: confirm the SDK's HTTP/SSE transport actually supports the intended long-lived server pattern before building further. If it doesn't fit cleanly, STOP and report back to the Supervisor rather than working around it silently (Karpathy: Ask vs. Guess).

Minimal file set: `Dockerfile`, `docker-compose.yml`, `src/server.ts` (MCP server + HTTP/SSE transport + health check), `src/tools/web.ts` (just `ui_navigate` for this slice), `package.json`/`tsconfig.json`.

---

## Edge Case Checklist

- [ ] Target URL is unreachable / DNS fails at `ui_navigate` — must return a clear error, not hang
- [ ] `/health` responds promptly even while a navigation is in progress (not blocked by browser automation)
- [ ] Container restart mid-navigation does not leave a zombie process

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `Dockerfile` | New — based on `mcr.microsoft.com/playwright`, installs Node deps, runs `src/server.ts` |
| `docker-compose.yml` | New — single service, port 8765 exposed, `reports/` volume mount stub (used fully in T003) |
| `package.json`, `tsconfig.json` | New — TypeScript + Node.js project setup |
| `src/server.ts` | New — MCP server entrypoint, HTTP/SSE transport, `/health` route |
| `src/tools/web.ts` | New — `ui_navigate` tool implementation only |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/`, `templates/`, `memory/` | Supervisor framework scaffolding |
| `src/tools/mobile.ts` | Out of scope — v2 only, do not create beyond an empty stub if needed for structure |

---

## Test Plan

Automated: health check endpoint test, `ui_navigate` success + failure-path test (unreachable URL). Manual: `Skill({ skill: "verify" })` — actually connect Claude Code to the running container and call `ui_navigate`, confirm the response.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk — mandatory)
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — Claude Code confirmed connecting and calling `ui_navigate` in the running container
- [ ] `memory/MEMORY.md` updated (transport spike findings, any deviation from the plan)
- [ ] Supervisor notified: task ready for Stage 4 review
