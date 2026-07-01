# BRAINSTORMING_LOG.md
**Generated**: 2026-07-01
**Task / Context**: Phase 0 — UI Testing MCP Server (easy-ui-mcp), post-PRD grilling
**Skill**: `Skill({ skill: "brainstorming" })`

---

## The Problem Space

Claude Code needs a locally-running, Dockerized MCP server that lets it drive real browser interactions against a target web app, capture evidence (screenshots + page state), and receive a structured report — without the server itself needing an LLM API key or doing its own NL reasoning. Non-negotiable constraints locked in Phase 0 / grilling: Web-only v1, Docker Engine (not Desktop), HTTP/SSE transport on `localhost:8765`, Chromium only, fail-fast on error, JSON+HTML reports with screenshots, single-command startup.

---

## Questions for the User

All resolved during this session (see Recommended Path below):
1. Should the server reason about NL flows internally, or expose primitives for the calling agent to reason with? → **Resolved: primitives.**
2. How should a "test run" be scoped for reporting? → **Resolved: explicit start/end session tools.**
3. Docker base image: official Playwright image or manual install? → **Resolved: official Playwright image.**

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | The Simple Path (Primitives + Sessions) | Server exposes primitive Playwright actions + explicit session bracketing; Claude Code reasons | Low | ~600-800 lines | Low | ✅ Yes |
| B | The Autonomous Path (Server-Side LLM) | `ui_run_flow` takes NL description, server calls an LLM internally to plan/execute | High | ~1500+ lines | High | |
| C | The Minimalist Path (Single Mega-Tool) | One `ui_execute(playwright_script)` tool takes raw Playwright code from the agent, no MCP abstraction | Low | ~300 lines | Medium | |

### Option A — The Simple Path (Primitives + Sessions)
**Approach**: MCP tools = `ui_start_session(target)`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`, `ui_end_session()`. Claude Code (the calling agent) interprets the NL flow description itself and calls these tools in sequence, observing state between calls. Server just executes actions + logs them for the report.
**Pros**: No LLM/API key inside the container; matches `playwright-mcp`'s proven tool shape; simple, debuggable, deterministic per-call; clean session-scoped reports; smallest attack surface.
**Cons**: Claude Code does more round-trips (more tool calls per flow) than a single opaque call; requires Claude Code to hold flow state across calls (acceptable — that's exactly what an agent loop does).
**Why it might fail**: If the calling agent isn't good at reasoning about page state from `ui_get_page_state` output, flows could stall on ambiguous selectors — mitigated by returning accessibility-tree-style structured state, not raw HTML.

### Option B — The Autonomous Path (Server-Side LLM)
**Approach**: `ui_run_flow(description, target)` is the only tool; the server calls an LLM internally to plan each step, loop until done, then return final result.
**Pros**: Single call from Claude Code's perspective; server "just works."
**Cons**: Container needs its own LLM credentials (security/cost surface); duplicates reasoning Claude Code already does; much more code (planning loop, retries, prompt engineering, error recovery) — directly fails the 50% Rule; harder to debug ("black box" failures).
**Why it might fail**: Two LLMs now in the loop (Claude Code + server's internal LLM) — failure attribution becomes ambiguous, and a bad step is invisible until the whole flow fails.

### Option C — The Minimalist Path (Single Mega-Tool)
**Approach**: One tool, `ui_execute(playwright_script: string)`, taking raw Playwright/JS the agent writes and `eval`-executing it server-side.
**Pros**: Extremely small server surface.
**Cons**: `eval`-ing agent-provided code server-side is a real security/sandboxing concern even for a local single-user tool; no structured tool interface for Claude Code to discover via MCP tool schemas; loses the clean primitive-action logging needed for reports; harder for a human to read/audit a "flow" after the fact.
**Why it might fail**: Report generation degrades to "here's a script and its console output" instead of a clear step-by-step HTML report — undermines FR-005/US-005 directly.

---

## 50% Rule Check

Option A already is the 50%-less-code path relative to B (no internal LLM planner, no retry/prompt-engineering logic). Applied further: use the **official `mcr.microsoft.com/playwright` Docker image** instead of hand-rolling Chromium install scripting (removes ~50-100 lines of Dockerfile/CI logic), and use the **MCP SDK's built-in HTTP/SSE transport** rather than building a custom transport layer.

---

## Recommended Path

**Option A — The Simple Path (Primitives + Sessions)**

Meets every FR/NFR from the PRD with the least code and smallest risk surface: no server-side LLM credentials needed, deterministic and debuggable, produces clean session-scoped reports, and directly reuses the proven `playwright-mcp` tool shape the original requirements doc pointed at.

---

## Surgical Scope

Files that **should** be touched (all new, greenfield):
- `src/server.ts` — MCP server entrypoint (HTTP/SSE transport)
- `src/tools/web.ts` — primitive Playwright tool implementations
- `src/tools/unified.ts` — session lifecycle (start/end) + tool registry
- `src/reports/` — JSON + HTML report generator
- `src/api/` — REST wrapper (`/api/run-test`, `/health`) for Phase 3
- `Dockerfile`, `docker-compose.yml` — based on `mcr.microsoft.com/playwright`
- `AGENTS.md`, `HARNESS.md` — connection + extension docs

Files that **must not** be touched:
- `.claude/agents/`, `.claude/skills/`, `templates/`, `memory/` — Supervisor framework scaffolding, unrelated to product code
- `src/tools/mobile.ts` — explicitly out of scope for v1 (create as stub only when Phase 4/v2 begins)

---

## Edge Case Checklist for TASK_GUIDE

- [ ] Target URL is unreachable / DNS fails at `ui_start_session` — must return a clear error, not hang
- [ ] `ui_click`/`ui_fill` called with a selector that matches 0 or >1 elements — fail fast per NFR-007, include selector in error
- [ ] Session left open (no `ui_end_session` call) — server must have a timeout/cleanup so browser contexts don't leak
- [ ] Two sessions started concurrently — must not clobber each other's report or browser context
- [ ] `/health` called while a session is mid-flow — must still respond promptly (not blocked by browser automation)
- [ ] Report generation when a screenshot file write fails (disk full, permissions) — must not crash the whole session
- [ ] Docker container restarted mid-session — in-flight session data should not corrupt the reports volume

---

## Next Actions

1. Stage 1: set up folder structure, `PROJECT_SPEC.md`, verify Docker Engine + Node/TS toolchain locally.
2. Stage 2: break into tracer-bullet tasks — likely: (T1) MCP server + primitive tools skeleton, (T2) session + report generation, (T3) Docker + docker-compose + health check, (T4) Claude Code connection verified end-to-end, (T5) REST wrapper (`/api/run-test`) for Harness integration, (T6) AGENTS.md/HARNESS.md docs.
3. Verify MCP SDK's HTTP/SSE transport support before committing to task estimates (quick spike in T1).

---

## User Selection

> **Approved direction**: Option A — The Simple Path (Primitives + Sessions)
> Approved by user on 2026-07-01.
