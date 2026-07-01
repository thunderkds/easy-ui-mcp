# PROJECT_SPEC.md
**Last updated**: 2026-07-01
**Version**: 1.0

> **Scope of this document**: *How* to build it safely — architecture, agent config, constraints, risk areas, task state, and accumulated learnings.
> Product intent (personas, user stories, FR/NFR, success metrics) lives in `PRD.md`.
> If Critical Constraints here conflict with Out of Scope in `PRD.md`, resolve before Stage 2.

---

## Project Identity

- **Name**: easy-ui-mcp (UI Testing MCP Server)
- **Repo**: local — `/home/hungnguyenhuu/workspace/pets/hungnguyen111/easy-ui-mcp` (not yet pushed to a remote beyond `origin`)
- **Primary tech**: TypeScript + Node.js (latest), Playwright, Docker Engine
- **Type**: Local MCP server + REST wrapper (backend/tooling project, no frontend UI)
- **Deployment target**: Local only — `docker-compose up -d`, `localhost:8765`
- **Key stakeholders**: hungnh1110 (solo developer)

---

## Architecture Summary

A Dockerized Node.js/TypeScript MCP server (based on the official `mcr.microsoft.com/playwright` image) exposes primitive Playwright web-automation tools over HTTP/SSE on `localhost:8765`. Claude Code drives multi-step flows itself by calling `ui_start_session` → primitive actions (`ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`) → `ui_end_session`, with the server logging each action server-side to produce a JSON + HTML report per session. A thin REST wrapper (`/api/run-test`, `/health`) exists for non-MCP callers. No LLM reasoning happens inside the container.

---

## Critical Constraints

- No server-side LLM calls or API keys inside the Docker container (Option A architecture decision — see `BRAINSTORMING_LOG.md`)
- Chromium only for v1 — do not add Firefox/WebKit browser installs without a scope change
- Web only for v1 — `src/tools/mobile.ts` stays a stub; no Appium/Maestro integration until v2
- MCP transport is HTTP/SSE on `localhost:8765` — do not switch to a stdio bridge without revisiting NFR-001
- Docker base image must be `mcr.microsoft.com/playwright` — do not hand-roll browser install scripting
- `.claude/agents/`, `.claude/skills/`, `templates/`, `memory/` are Supervisor framework scaffolding — implementers must not touch them

---

## Known Risk Areas

| Area | Risk Level | Reason | Files |
|------|-----------|--------|-------|
| MCP HTTP/SSE transport wiring | Medium | Unverified whether the MCP SDK's transport cleanly supports the session-bracketing model (start/end tools driving one long-lived browser context) — flagged for a Stage 3 spike | `src/server.ts` |
| Session/browser-context lifecycle | Medium | Leaked browser contexts (no `ui_end_session` call, concurrent sessions) could exhaust container resources | `src/tools/unified.ts` |
| Docker↔Claude Code connectivity (NFR-001) | Medium | Core success metric — must be verified working end-to-end, not just documented | `Dockerfile`, `docker-compose.yml`, `AGENTS.md` |

---

## Sub-Agent Team

| Agent | Role | CLI Spawn Command |
|---|---|---|
| Common-Infrastructure-Agent | Docker/compose setup, MCP server skeleton, health check | `Agent({ subagent_type: "common-infrastructure", prompt: "..." })` |
| Backend-Implementer | Primitive Playwright tools, session lifecycle, report generation, REST wrapper | `Agent({ subagent_type: "backend-developer", prompt: "..." })` |
| QA-Automation-Agent | Smoke tests, end-to-end Claude Code connection verification | `Agent({ subagent_type: "qa-expert", prompt: "..." })` |

> No Frontend-Implementer needed — this project has no UI surface (backend/tooling only). Confirmed with user at Stage 1.5.

---

## Tasks

_Populated in Stage 2 (`/plan`) — see `PROJECT_KANBAN.md` once generated._

| ID | Title | Status | Assigned Agent | Complexity | Risk | Priority |
|----|-------|--------|---------------|-----------|------|----------|

---

## Memory / Insights

Running log of key decisions, patterns, and lessons learned across tasks.

| Date | Insight | Source Task |
|------|---------|------------|
| 2026-07-01 | Chose primitive-tools + session-bracketing architecture (Option A) over server-side LLM planning — no LLM credentials needed in container, deterministic, matches playwright-mcp pattern | Stage 0.5 brainstorming |
| 2026-07-01 | MCP transport locked to HTTP/SSE on localhost:8765, not stdio bridge — cleaner fit for an always-on Docker service | Stage 0.5 grilling |
