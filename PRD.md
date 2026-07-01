# PRD — UI Testing MCP Server (easy-ui-mcp)
**Last updated**: 2026-07-01
**Status**: Approved
**Owner**: hungnh1110

> **Scope of this document**: *What* to build and *why* — product intent, user stories, requirements, success metrics.
> Technical decisions, architecture, agent config, and task state live in `PROJECT_SPEC.md`.
> If Out of Scope here conflicts with Critical Constraints there, resolve the conflict before Stage 2.

---

## Overview

Developers using AI coding agents (like Claude Code) currently have no fast, local, one-command way to drive real browser-based UI testing and get a shareable report back. This project builds a **unified UI Testing MCP Server** that runs in Docker locally, exposes Playwright-based web testing tools over MCP, and returns a clear HTML+JSON report with screenshots — so an AI agent or a human QA engineer can describe a flow in plain English and get a pass/fail report with evidence, without hand-writing test scripts. Mobile (Appium/Maestro) support is explicitly deferred to v2.

---

## Personas

| ID | Name | Role | Pain Point |
|----|------|------|-----------|
| P1 | AI Coding Agent (Claude Code) | Automated agent driving verification during development | No standard local MCP tool to run/verify UI flows and get structured evidence back |
| P2 | Solo Developer / QA Engineer | Human running local checks | Wants a one-command way to spin up UI testing infra and read a clear report, without configuring Playwright/browsers manually |

---

## User Stories

| ID | Story | Persona |
|----|-------|---------|
| US-001 | As Claude Code (P1), I want to connect to a locally running MCP server so that I can call UI testing tools directly during a session. | P1 |
| US-002 | As Claude Code (P1), I want a set of primitive browser-action tools so that I can interpret a natural-language flow myself, step by step, against a target URL and verify the app behaves as expected. | P1 |
| US-003 | As a developer (P2), I want to start the whole testing environment with one Docker command so that I don't have to install/configure Playwright browsers myself. | P2 |
| US-004 | As a developer or agent (P1/P2), I want a screenshot and page-state capture tool so that I can inspect the current UI state during a flow. | P1, P2 |
| US-005 | As a developer or agent (P1/P2), I want an HTML report with embedded screenshots after a run so that I can review what happened and share evidence. | P1, P2 |
| US-006 | As a developer (P2), I want a `/health` endpoint so that I can confirm the container is ready before running tests. | P2 |

---

## Functional Requirements

Each FR must trace to at least one User Story.

| ID | Requirement | Traces to |
|----|-------------|-----------|
| FR-001 | The system must expose an MCP server over HTTP/SSE on `localhost:8765`, reachable by Claude Code as a local MCP client, backed by a persistent Docker container (no stdio spawn/bridge required). | US-001 |
| FR-002 | The system must provide primitive Playwright action tools (`ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, etc.) so the calling agent (Claude Code) can reason step-by-step and interpret a natural-language flow description itself — no LLM call happens inside the server. | US-002 |
| FR-002a | The system must provide `ui_start_session(target)` and `ui_end_session()` tools to bracket a test run; all primitive actions between them are logged server-side into one report. | US-002, US-005 |
| FR-003 | The system must provide a `ui_take_screenshot` tool that captures the current browser viewport and saves it to the reports output. | US-004 |
| FR-004 | The system must provide a `ui_get_page_state` tool that returns the current page's DOM/accessibility-relevant state (e.g. URL, title, visible elements) to inform the next step. | US-004 |
| FR-005 | The system must generate a JSON report and a self-contained HTML report (with embedded/linked screenshots) for every session between `ui_start_session` and `ui_end_session`. | US-005 |
| FR-006 | The system must start fully via `docker-compose up -d` with no manual browser install steps. | US-003 |
| FR-007 | The system must expose a `/health` HTTP endpoint reporting readiness. | US-006 |
| FR-008 | The system must persist reports to a Docker volume-mounted `reports/` folder accessible from the host. | US-005, US-003 |
| FR-009 | The system must document (in AGENTS.md) the exact MCP connection configuration Claude Code needs to point at the running Docker container. | US-001 |

---

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-001 | Claude Code must be able to connect to the MCP server via HTTP/SSE at `localhost:8765` while it runs inside the Docker container — connection setup must be verified working (a real Claude Code MCP config added and tested), not just documented. | Integration |
| NFR-002 | Full environment must start with a single command (`docker-compose up -d`) on Docker Engine (Linux), with no Docker Desktop dependency. | Usability |
| NFR-003 | The MCP server and its HTTP surface must run on `localhost:8765` by default. | Compatibility |
| NFR-004 | The codebase must be TypeScript + Node.js (latest LTS or newer). | Maintainability |
| NFR-005 | AGENTS.md and HARNESS.md must give a future agent (human or AI) enough context to extend the project without re-deriving architecture decisions. | Maintainability |
| NFR-006 | v1 supports Chromium only (Playwright). Firefox/WebKit are deferred; the tool interface must not need to change to add them later. | Compatibility |
| NFR-007 | On a failing step within `ui_run_flow`, execution must fail fast: stop at the failing step, capture a screenshot + error context at that point, and still emit a report marked as failed. | Reliability |

---

## Success Metrics / KPIs

| Metric | Baseline | Target | How measured |
|--------|----------|--------|--------------|
| Time to first successful local run | N/A (no tool exists) | `docker-compose up -d` → successful `ui_run_flow` call in < 5 min | Manual timed walkthrough |
| Claude Code can connect and run a flow | N/A | Claude Code executes `ui_run_flow` against a real page and receives a valid HTML report path | Manual verification during Stage 5 |
| Report completeness | N/A | 100% of runs produce both JSON and HTML report with at least one screenshot | Manual inspection of `reports/` output |

---

## Out of Scope

The following are explicitly excluded from this project (v1):

- Mobile/native testing via Appium + Maestro (deferred to v2)
- iOS support (deferred; would require Mac-specific tooling)
- CI/CD pipeline triggers (GitHub Actions / Harness pipeline steps) — local execution only for v1
- Cloud device farms
- Authentication / multi-tenant support
- Video recording of test runs (screenshots only for v1)
- Scripted/deterministic fixed-step flow definitions (agentic natural-language flows only for v1)

---

## Open Questions / Assumptions

| # | Question / Assumption | Owner | Due |
|---|----------------------|-------|-----|
| 1 | `ui_run_flow` uses natural-language description with the calling AI agent driving Playwright step-by-step (agentic), rather than scripted/deterministic flows. Deferred by user ("up to you"); reversible — scripted flows could be added later as a separate tool if agentic driving proves unreliable. | hungnh1110 | Revisit post-v1 if needed |
