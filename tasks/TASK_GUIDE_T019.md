# TASK_GUIDE — T019: Missing interaction primitives
**Date**: 2026-10-30
**Complexity Level**: C2
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `memory/codebase-map.md` if present
7. Read `BRAINSTORMING_LOG_agent-ergonomics.md` § "T019"

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-10-30): make the MCP "easy for the agent to drive". Investigation finding #3: there is no way to choose a `<select>` option, press a key, hover, check/uncheck, or scroll — forms that submit on Enter, dropdowns, hover menus and lazy lists cannot be driven.

**Restated intent**:
> The agent can drive the common interactions a human uses on a web form or menu, each as one primitive tool that behaves and reports like `ui_click`.

**Out of scope**:
- File upload, drag-and-drop, multi-tab, iframes
- A generic `ui_action(kind, …)` multiplexer (rejected in brainstorm)

**Requirement Refs**:
- FR-002: primitive Playwright action tools (`ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, etc.)
- FR-002a: all primitive actions between start/end are logged into one report
- US-002

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor, 2026-10-30 — provisional; **tool names pending user confirmation**)
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Dependencies & Reachability

**Depends on**: T018 — selectors returned by `ui_get_page_state` are the input these tools take

**Entry point**: `ui_select_option`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_select_option(selector, value)` selects by option value or visible label on a unique `<select>` | choose a select option |
| 2 | `ui_press_key(key, selector?)` presses a Playwright key name (`Enter`, `Tab`, `Escape`, `ArrowDown`…) on the focused element or on `selector`; Enter in a text input submits its form | press a key |
| 3 | `ui_hover(selector)` hovers so `:hover`/mouseenter-revealed content becomes visible | hover |
| 4 | `ui_set_checked(selector, checked)` sets a checkbox/radio to the requested state (idempotent) | check/uncheck |
| 5 | `ui_scroll(selector?)` scrolls `selector` into view, or the page down one viewport when omitted | scroll |
| 6 | Each tool: requires exactly one match (reuse `resolveUniqueLocator`), fails clearly with no active page, is logged via `recordAction`, and a failure is hard (marks the session failed + failure screenshot) exactly like `ui_click` | behaves and reports like ui_click |
| 7 | `describe()` in `src/reports/index.ts` renders each new action as a readable sentence (e.g. `Selected "Vietnam" in #country`) | report readability |
| 8 | Invalid inputs fail clearly: unknown option, unknown key name, `ui_set_checked` on a non-checkbox | negative |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture form with select, text input inside `<form onsubmit>`, hover-reveal menu, checkbox, tall page | each tool produces its observable DOM effect | automated tests `test/web.test.ts` |
| 2 | Unknown option / bad key / non-checkbox | `{ok:false, error}` naming the problem | automated tests |
| 3 | `describe()` for each new action | readable sentence, HTML-escaped | `test/reports.test.ts` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts test/reports.test.ts test/session.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T019.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T019.md`.

---

## Approach

**Pattern reference**: `ui_click` registration in `src/server.ts` and `click()` in `src/tools/web.ts` — copy that shape exactly (web.ts function returning `ActionResult`, never throws; server tool resolves page, records action, returns `isError` on failure).

**Vital slice**: five thin wrappers over Playwright locator methods (`selectOption`, `press`/`keyboard.press`, `hover`, `setChecked`, `scrollIntoViewIfNeeded`/`mouse.wheel`).
**Cut list**: file upload; drag-and-drop; per-tool timeout parameters.

---

## Edge Case Checklist

- [ ] `ui_select_option` on a `<select multiple>` → single value only, documented
- [ ] `ui_press_key` with no selector and nothing focused → presses on `body`, does not fail
- [ ] `ui_set_checked(false)` on an already-unchecked box → ok, no-op
- [ ] `ui_scroll` on a non-scrollable page → ok, no error
- [ ] Tool descriptions steer the agent: use `ui_get_page_state` selectors

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | five new functions |
| `src/server.ts` | five tool registrations |
| `src/reports/index.ts` | `describe()` phrases only |
| `test/web.test.ts`, `test/reports.test.ts` | AC tests |
| `AGENTS.md` | tool list |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/session.ts` | unrelated |
| `writeReports`/index code in `reports/index.ts` | T021 |

---

## Test Plan

Test-first per tool with one shared `setContent` fixture; then the verification command; then a live drive against the rebuilt container (one session using every new tool) to confirm the report reads well.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T019.md`
- [ ] `AGENTS.md` tool list updated
- [ ] Supervisor notified: task ready for Stage 4 review
