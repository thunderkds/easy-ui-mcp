# TASK_GUIDE — T039: Position easy-ui-mcp as a UI-testing MCP with evidence (README + docs site)
**Date**: 2026-11-11
**Risk Level**: Low (docs and static page only; no `src/` change; one test list updated)
**Assigned agents**: Supervisor (docs text, same as T026–T028)

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `README.md`, `site/index.html`, `test/site.test.ts`, `test/docs-tools.test.ts` and this guide.)

## Requirement
User, 2026-11-11, with a positioning note pasted in: "investigate and update the README, index pages, or the related documentations for specialized focusing to highlight what we have done".

The note says easy-ui-mcp is not a general browser controller. It is a local UI-testing MCP that gives the agent structured, shareable test reports. Its five points: automatic structured reports, testing-oriented primitives, local-first and Dockerized, no LLM inside the server, designed for Claude Code.

## Facts checked against the code (2026-11-11)
| Claim | Verdict |
|-------|---------|
| Every session writes a JSON + self-contained HTML report with screenshots, step labels, pass/fail, logs | True (T003, T014, T021, T024) |
| `ui_start_session` / `ui_end_session` / `ui_step`, and `ui_assert` vs `ui_check` vs `ui_wait_for` | True (T013, T014) |
| `docker compose up` is enough, no cloud account, no API key | True. Since T038 a stdio entry (`dist/stdio.js`) also exists for hosted proxies |
| No LLM inside the server | True (PRD FR-002) |
| HTTP/SSE registration and multi-session | True (T029: up to 3 sessions per connection) |
| "Most tools just give you raw actions" | Not checked against other products. Do not name or judge other tools; say only what this one does |

Extra proof points we built that the note does not mention: truthful verdicts (soft vs hard outcomes), browser problems captured in the report (console, page errors, failed requests, HTTP 4xx/5xx) so a green run cannot hide a throwing console, selectors verified against the live page, native dialogs held for the agent, device and viewport emulation, measured report size (357 KB to 4 KB).

## Acceptance Criteria
- [x] `README.md` opens with the positioning line and a short "Why easy-ui-mcp" table (five points + the extra proof points) before Quick Start. All existing sections stay.
- [x] README "Scope (v1)" no longer reads as stale: it states web-only Chromium, the HTTP default and the stdio entry, and that Android is on hold (see `PROJECT_KANBAN.md`).
- [x] `site/index.html`: `<title>`, meta description, hero eyebrow/lede and the three hero tiles state the testing-and-evidence focus. Still exactly three tiles; hero still says "26 tools".
- [x] `site/index.html` gets a new section `#why-easy-ui` (after `#overview`, before `#how-it-works`) with a sidebar link, built only from existing CSS classes (no new colours, no inline style).
- [x] `package.json` `description` matches the positioning.
- [x] `test/site.test.ts`: `SECTION_IDS` includes `why-easy-ui` in order; one new test asserts the section's five points and the hero focus.
- [x] No claim about other products. No claim the code does not back.
- [x] Full `npm test` 0 failures.

## Approach
Reuse the page's existing `.cards` list and `.callout`. Keep sentences short (ASD-STE100 style, as in the rest of the docs).

## Files to change (predicted)
| File | Change |
|------|--------|
| `README.md` | positioning line, "Why easy-ui-mcp" table, Scope section |
| `site/index.html` | title, description, hero, new `#why-easy-ui` section, sidebar link |
| `package.json` | `description` |
| `test/site.test.ts` | section list, one new test |
| `PROJECT_KANBAN.md`, `PROJECT_SPEC.md` | board row; insight line |

## Files must NOT touch
| File | Reason |
|------|--------|
| `src/**` | docs-only task |
| `AGENTS.md`, `CLAUDE.md`, `HARNESS.md` | kit doctrine / REST reference; not part of this positioning |

## Verification Command
```
node --import tsx --test test/site.test.ts test/docs-tools.test.ts && npm test
```

## Completion checklist
- [x] Implementation done
- [x] Tests pass
- [x] Page checked in a browser at 375px and 1280px
- [x] KANBAN updated
- [x] TASK_GUIDE marked complete
