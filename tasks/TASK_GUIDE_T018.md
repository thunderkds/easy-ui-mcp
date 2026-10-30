# TASK_GUIDE — T018: Actionable selector per element in `ui_get_page_state`
**Date**: 2026-10-30
**Complexity Level**: C2
**Risk Level**: Medium
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
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `memory/codebase-map.md` if present
7. Read `BRAINSTORMING_LOG_agent-ergonomics.md` § "T018"

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-10-30): make the MCP "easy for the agent to drive". Investigation finding #2: each page-state element is `{role, name}` with nothing that can be passed to `ui_click`/`ui_fill`, so the agent invents CSS selectors — the main source of `No element matched` / `matched N elements` failures.

**Restated intent**:
> Every element returned by `ui_get_page_state` carries a `selector` string that, passed unchanged to `ui_click` or `ui_fill`, targets exactly that element.

**Out of scope**:
- New action tools (T019)
- Server-side element reference maps / opaque ref IDs (rejected in brainstorm)
- Changing `ui_click`/`ui_fill` input schemas (still one `selector: string`)

**Requirement Refs**:
- FR-002: primitive Playwright action tools the agent drives step by step
- FR-004: page state informs the next step
- US-002, US-004

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor, 2026-10-30 — provisional per user's "auto, defer confirmations" instruction)
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Dependencies & Reachability

**Depends on**: T017 — `getPageState` name resolution and `messages` field must exist (same function)

**Entry point**: `ui_get_page_state`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | Each returned element has a `selector: string` | carries a selector |
| 2 | Strategy order, first one that matches exactly one element wins: `[data-testid="…"]` → `#<id>` (CSS-escaped) → `role=<role>[name="<name>"]` → the role selector with ` >> nth=<i>` appended | targets exactly that element |
| 3 | For every element in a fixture with duplicate button labels, ids with special characters, a `data-testid`, and an unlabeled-but-placeholdered input, `click`/`fill` with the returned `selector` succeeds and acts on the intended element (verified by an observable side effect) | passed unchanged to ui_click/ui_fill |
| 4 | Quotes and backslashes in names are escaped so the selector parses | boundary |
| 5 | `ui_click`/`ui_fill` tool descriptions (in `src/server.ts`) say the selector may be a CSS selector or the `selector` value from `ui_get_page_state`, and that positional (`nth=`) selectors must be refreshed after the page changes | agent guidance |
| 6 | `ui_get_page_state` output size stays bounded: elements capped (e.g. 200) with a truncation note | boundary |
| 7 | T017 tests and all existing `web.test.ts` tests still pass | no regression |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture: two `<button>Delete</button>` rows, `<button data-testid="save">Save</button>`, `<input id="a:b" placeholder="Name">`, `<a href=#>Help "me"</a>` | selectors: `[data-testid="save"]`, `#a\:b`, `role=link[name="Help \"me\""]`, and two distinct `… >> nth=0/1` for Delete; each one clicks/fills the intended element | automated test in `test/web.test.ts` |
| 2 | Every element selector from a realistic fixture | `page.locator(selector).count() === 1` for all | automated test |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T018.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T018.md`.

---

## Approach

**Pattern reference**: `src/tools/web.ts` `resolveUniqueLocator` — the exactly-one-match rule this task must satisfy by construction.

**Vital slice**: selector generation + uniqueness check in `getPageState`.
**Cut list**:
- Stable refs across DOM mutations
- XPath strategies
- Text-engine (`text=`) selectors

Brainstorm Option A. Generate candidate selectors in Node (not in-page), after collecting `{role, name, testId, id, index}` per element from the `$$eval`; verify each candidate with `page.locator(candidate).count()` and keep the first that returns 1. Bound cost: candidates are checked only until one is unique. Note Playwright's `role=` engine uses the accessible name computed by Chromium, which may differ from T017's helper — the count check guards that; fall back to `nth=` against the CSS position list if role matching yields 0.

Risk is Medium because `getPageState` output is what every agent run plans against — a wrong selector silently clicks the wrong element.

---

## Edge Case Checklist

- [ ] `id` that is not a valid CSS identifier (`a:b`, starts with a digit) → `CSS.escape`-equivalent
- [ ] Duplicate `id`s on the page → id strategy rejected by the count check
- [ ] Role selector matches 0 because Chromium's accessible name differs → falls through to a positional selector that still works
- [ ] Element inside an iframe → not returned (out of scope), never a broken selector
- [ ] Performance: page with 500 interactive elements stays under ~2s

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | `getPageState` selector generation; `PageState` element type |
| `src/server.ts` | `ui_click`/`ui_fill`/`ui_get_page_state` descriptions only |
| `test/web.test.ts` | AC tests |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/reports/index.ts` | T021 |
| `src/tools/session.ts` | unrelated |

---

## Test Plan

Test-first with `setContent` fixtures; prove every returned selector round-trips through `click`/`fill`. Then the verification command.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T018.md`
- [ ] Security review run (Medium risk) — selector strings are built from page content; confirm no injection into anything other than Playwright locators
- [ ] Supervisor notified: task ready for Stage 4 review
