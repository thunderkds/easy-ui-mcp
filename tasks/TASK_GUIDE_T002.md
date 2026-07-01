# TASK_GUIDE — T002: Remaining Primitive Playwright Tools
**Date**: 2026-07-01
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P0
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Apply the C1 process from the Complexity matrix in `.claude/agents/general-agent-template.md`
6. C1, single-area task — `memory/codebase-map.md` optional, skim `src/tools/web.ts` from T001 directly instead

---

## Requirement (Pillar 1 — Adapt the requirement)

Add the remaining primitive Playwright MCP tools to `src/tools/web.ts`, alongside the `ui_navigate` tool built in T001: `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`. These let Claude Code drive a full multi-step browser flow by chaining tool calls and reasoning over returned state.

**Restated intent**:
> Claude Code can click elements, fill form fields, assert conditions, read structured page state, and capture screenshots — all via MCP tool calls against the browser session opened by `ui_navigate` — without any of this reasoning happening server-side.

**Out of scope**:
- Session bracketing (`ui_start_session`/`ui_end_session`) and per-session report logging — T003
- REST wrapper — T004

**Requirement Refs** (from `PRD.md`):
- FR-002: primitive Playwright action tools so the calling agent reasons step-by-step
- FR-003: `ui_take_screenshot` captures viewport, saves to reports output
- FR-004: `ui_get_page_state` returns DOM/accessibility-relevant state
- NFR-006: Chromium only
- NFR-007: fail-fast on a failing step — stop, capture screenshot + error context, still emit a failed report (report emission itself lands in T003; this task must at minimum fail clearly and synchronously)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_click(selector)` clicks the matching element; if 0 or >1 elements match, returns a clear error including the selector | FR-002, NFR-007 |
| 2 | `ui_fill(selector, value)` fills the matching input; same 0/>1 match error handling as `ui_click` | FR-002, NFR-007 |
| 3 | `ui_assert(condition)` evaluates a condition against current page state and returns pass/fail with details | FR-002 |
| 4 | `ui_get_page_state()` returns structured state (URL, title, visible interactive elements) usable by an agent to decide the next action | FR-004 |
| 5 | `ui_take_screenshot()` captures the current viewport and writes a file to the reports output path | FR-003 |
| 6 | All five tools are discoverable via MCP tool schema alongside `ui_navigate` | FR-002 |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Page loaded via `ui_navigate`, valid selector passed to `ui_click` | Element clicked, success response | automated test against a local static test page |
| 2 | Selector matching 0 elements passed to `ui_click` | Clear error naming the selector, no hang | automated test |
| 3 | Selector matching 2+ elements passed to `ui_click` | Clear error naming ambiguity, no silent first-match click | automated test |
| 4 | `ui_get_page_state()` called on a known test page | Returns URL, title, and a list of visible interactive elements | automated test |
| 5 | `ui_take_screenshot()` called | PNG file written to reports output path, path returned to caller | automated test |

### Verification Command (exact, runnable)

```bash
npm test -- tools/web
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ✅ pass | `test/web.test.ts` — 13 new tests added (18 total incl. T001's). Covers click/fill success + 0/>1-match errors, assert true/false/no-page, page-state shape/no-page, screenshot write/no-page. 18/18 pass. |
| Verification command run | ✅ pass | `npm test` → 18/18 pass. Live MCP protocol drive against rebuilt container: tools/list shows all 6 tools; full flow navigate→get_page_state→click→assert→screenshot all succeeded with real output (see verification report). |
| Negative cases hold | ✅ pass | `ui_click`/`ui_fill` before `ui_navigate` → clean "No active page" error (post-fix); 0-match selector → clean "No element matched" error; both confirmed live against running container |
| verify | ✅ pass | Live MCP wire protocol drive of all 6 tools end-to-end, including probes for the no-page guard and 0-match selector fail-fast. Found + fixed a real inconsistency (ui_click/ui_fill silently auto-creating a page) during code review, re-verified live after fix. See verification report in conversation, 2026-07-01. |
| Review scope bounded to the change's blast radius | ✅ pass | Reviewed only T002's changed files: `src/tools/web.ts`, `src/server.ts`, `test/web.test.ts` |
| Full smoke suite still green (no regression) | ✅ pass | 18/18 tests pass (5 from T001 + 13 new), including T001's `ui_navigate` and `/health` tests — no regression |
| **UI: Visual regression** | ☐ N/A | No UI — backend/tooling task |
| **UI: Design-system compliance** | ☐ N/A | No UI — backend/tooling task |
| **UI: Responsiveness** | ☐ N/A | No UI — backend/tooling task |

---

## Approach

Extend `src/tools/web.ts` from T001 with the same tool-registration pattern used for `ui_navigate`. Use Playwright's own selector/locator APIs (`page.locator(selector)`) — do not reimplement element matching. For `ui_get_page_state`, prefer Playwright's accessibility snapshot over raw HTML dump (cheaper for the calling agent to reason over, per the edge case noted in brainstorming).

---

## Edge Case Checklist

- [ ] `ui_click`/`ui_fill` called with a selector that matches 0 or >1 elements — fail fast, include selector in error (from `BRAINSTORMING_LOG.md`)
- [ ] Screenshot file write fails (disk full, permissions) — must not crash the whole session, return a clear error instead
- [ ] `ui_assert` called before any `ui_navigate` — must fail clearly ("no active page") rather than throwing an unhandled exception

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | Add `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot` tool implementations |
| `src/server.ts` | Register the new tools with the MCP server |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `Dockerfile`, `docker-compose.yml` | Owned by T001, no changes needed for this slice |
| `.claude/`, `templates/`, `memory/` | Supervisor framework scaffolding |

---

## Test Plan

Unit/integration tests against a local static HTML fixture page (avoids flaky external-site dependencies) covering each tool's success and failure paths, especially the 0/>1-match error cases.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
