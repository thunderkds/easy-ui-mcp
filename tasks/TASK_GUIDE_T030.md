# TASK_GUIDE — T030: See the page — overlays, element state, widgets, focus, `ui_get_text`
**Date**: 2026-11-10
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `memory/codebase-map.md` if present
7. Read `BRAINSTORMING_LOG_browser-actions.md` — rows B5, B6, C2, C3, D2, F1

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-11-10): "with this UI MCP we can take screenshots and debug the flow, but some actions we can not do… check all the needed actions". The full audit (`BRAINSTORMING_LOG_browser-actions.md`) found that most failures come from what the agent **cannot see**, not only what it cannot do. The user agreed to the plan and its P0 group on 2026-11-10.

Verified gaps:
- `ui_get_page_state` returns `{role, name, selector}` only (`src/tools/web.ts:304`): no disabled / checked / value / expanded.
- `INTERACTIVE_SELECTOR` (`src/tools/web.ts:325`) leaves out `combobox`, `listbox`, `option`, `switch`, `menuitemcheckbox`, `menuitemradio`, `treeitem`, `slider`, `spinbutton`, `searchbox`, `summary`, `[contenteditable]` and `[tabindex]` widgets. Custom selects, toggles and rich-text editors never get a selector.
- Open modals (`role=dialog/alertdialog`, `dialog[open]`, `[aria-modal=true]`) are not reported, so the agent can't tell an overlay opened or closed.
- The focused element is not reported.
- No tool returns page text. `ui_assert`/`ui_check` return only true/false, so the agent can't read a table value, a heading or a field error.

**Restated intent**:
> `ui_get_page_state` tells the agent everything it needs to decide the next step: which controls exist, including custom widgets; their state; which overlay is open; and what has focus. A new `ui_get_text` reads visible text, so the agent can check content without guessing a JS expression.

**Out of scope**:
- New actions (T031–T033)
- Accessibility-tree snapshot (`ariaSnapshot`)
- Elements inside iframes
- Value-returning `ui_evaluate` (later, if ever)

**Requirement Refs**:
- FR-004: `ui_get_page_state` (extended by this task)
- FR-022 (new, added by this task): page state reports element state, overlays, focus and custom-widget roles; `ui_get_text` returns visible text
- US-002

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed by the user (2026-11-10, "agree, create the task guides")
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] FR-022 added to `PRD.md` and covered by the Acceptance Criteria

---

## Dependencies & Reachability

**Depends on**: none.
**Coordinate with**: T029 (multiple sessions, in Todo). Both change `src/server.ts`; whichever merges second rebases. If T029 has merged, `ui_get_text` takes the same optional `session_id` as every other session-aware tool.

**Entry point**: MCP tools `ui_get_page_state`, `ui_get_text`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | Each element in `ui_get_page_state` may carry a `state` object with only the non-default fields: `disabled`, `checked` (true/false/"mixed"), `value` (inputs, textarea, select; capped at 100 chars; **never for `type=password`**), `expanded`, `selected`, `pressed`, `required`, `invalid` (`aria-invalid` or `:invalid` after interaction) | element state |
| 2 | Custom-widget roles above, `summary`, `[contenteditable]` (not `"false"`) and elements with `tabindex >= 0` plus a role are listed with a working selector (round-trip: `ui_click` on the selector hits that element) | custom widgets |
| 3 | Page state has `overlays: [{role, name, selector, modal}]` for visible `[role=dialog]`, `[role=alertdialog]`, `dialog[open]`, `[aria-modal=true]`; topmost first; the key is **omitted** when none are open | overlay open/closed |
| 4 | A closed overlay (`hidden`, `display:none`, `visibility:hidden`, `aria-hidden=true`, removed) is not listed | overlay closed |
| 5 | Page state has `focused: {role, name, selector}` when focus is on an element other than `body`; omitted otherwise | focus |
| 6 | `ui_get_text(selector?)` returns the trimmed visible `innerText` of the single matching element, or of `body` with no selector; capped at 4000 chars with a `…(truncated, N chars)` note | read page text |
| 7 | `ui_get_text` on 0 or >1 matches or with no active page fails like `ui_click` (`resolveUniqueLocator`), recorded via `recordAction`; a failure is hard | behaves like other tools |
| 8 | `describe()` renders `ui_get_text` as a readable sentence (e.g. `Read text of "#total"`), HTML-escaped; the returned text is **not** stored in the report args | report readability |
| 9 | Output stays bounded: 200-element cap unchanged; existing page-state consumers and tests pass unchanged except for the new optional fields | no regression |
| 10 | Tool descriptions, `AGENTS.md`, `HARNESS.md`, `README.md`, `RUNBOOK.md` and `site/index.html` describe the new fields and tool; the doc-drift test passes | agent guidance |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | `setContent` fixture: disabled button, checked box, filled input, password input, `aria-expanded` accordion, custom `role=combobox` + `role=option` list, `role=switch`, contenteditable div | each listed with the right `state`; password has no `value`; every selector round-trips | `test/web.test.ts` |
| 2 | Fixture with a `<dialog>` opened by `showModal()`, then closed; a div `role=dialog aria-modal=true` toggled with `hidden` | `overlays` present while open, absent after close | `test/web.test.ts` |
| 3 | Focus an input, then blur | `focused` names the input, then is omitted | `test/web.test.ts` |
| 4 | Page with a `#total` cell and 10k chars of body text | `ui_get_text("#total")` = the cell text; `ui_get_text()` truncated with note | `test/web.test.ts` |
| 5 | `describe()` for `ui_get_text` | readable, escaped | `test/reports.test.ts` |
| 6 | Live: rebuilt container, Claude Code opens a modal on a real page, reads `overlays`, presses Escape, reads page state again | overlay listed, then gone | Stage 5 `verify` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts && node --import tsx --test test/reports.test.ts && node --import tsx --test test/docs-tools.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T030.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T030.md`.

---

## Approach

**Brainstorming**: done — `BRAINSTORMING_LOG_browser-actions.md`, Option B (extend existing tools, add few new ones), approved by the user 2026-11-10.

**Pattern reference**:
- `getPageState()` in `src/tools/web.ts:468`: extend the same single `$$eval` pass and selector-verification loop.
- `ui_get_page_state` registration in `src/server.ts`.
- For `ui_get_text`, use `runInteraction` + `onUniqueLocator` (T019 shape).

**Vital slice**: wider `INTERACTIVE_SELECTOR`; `state` read in the existing in-page pass; `overlays` + `focused` from the same pass; `ui_get_text`.
**Cut list**:
- Heading/landmark outline in page state
- Text of non-interactive elements in page state (that's what `ui_get_text` is for)
- Heuristic overlay detection for non-ARIA `div.modal` (record it in the review as a follow-up if seen on a real app)

---

## Edge Case Checklist

- [ ] No named inner functions inside `$$eval`/`evaluate` callbacks (tsx `__name` gotcha, T017)
- [ ] `[tabindex]` widened carefully: only `tabindex >= 0` **with** a role or click handler-free container excluded; don't flood the 200-element cap with layout divs
- [ ] `type=password` value never returned, never logged
- [ ] Long `value` / text capped; no binary or huge JSON in page state
- [ ] `<dialog open>` without `showModal()` → `modal: false`
- [ ] Nested overlays (menu inside modal) → both listed, topmost first
- [ ] `focused` inside a shadow root or iframe → omitted rather than wrong
- [ ] `nth=` selectors in `overlays` follow the same staleness note as elements

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | `INTERACTIVE_SELECTOR`, `PageElement.state`, `PageState.overlays/focused`, `getText()` |
| `src/server.ts` | `ui_get_text` registration (via `TOOL` map), `ui_get_page_state` description |
| `src/reports/index.ts` | `describe()` case for `ui_get_text` only |
| `test/web.test.ts`, `test/reports.test.ts`, `test/docs-tools.test.ts` | AC tests |
| `PRD.md` | FR-022 |
| `AGENTS.md`, `HARNESS.md`, `README.md`, `RUNBOOK.md`, `site/index.html` | tool list + count, new fields |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/session.ts` | no session change needed |
| `isFatalOutcome`, `resolveUniqueLocator` | contracts shared by every tool |
| `src/api/run-test.ts` | REST shape unchanged |

---

## Test Plan

Test-first with `page.setContent` fixtures per AC (one fixture per concern). Run the verification command, then the existing suites individually (memory: multi-file glob can hang). Then Stage 5 live check on a spare port per memory ("MCP drive on a spare port") and on the rebuilt container.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T030.md`
- [ ] Security review run (Medium risk) — password values never exposed in page state or report
- [ ] Docs updated (AC 10), FR-022 in `PRD.md`
- [ ] Supervisor notified: task ready for Stage 4 review
