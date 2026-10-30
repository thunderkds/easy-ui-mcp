# TASK_GUIDE — T017: Fix `ui_get_page_state` naming and surface on-page messages
**Date**: 2026-10-30
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
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `BRAINSTORMING_LOG_agent-ergonomics.md` § "T017"

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-10-30): make the MCP "easy for the agent to drive" and "executable, simple as is". Investigation finding #1 (reproduced 2026-10-30): `ui_get_page_state` drops text inputs that are named only by `<label for>` or `placeholder`, and never reports alert/error text, so the agent cannot see the form fields it must fill or the validation messages it must react to.

**Restated intent**:
> Every visible interactive element a human could identify by its label shows up in `ui_get_page_state` with a sensible name, and visible alert/status messages are reported, so the agent can plan its next action without guessing.

**Out of scope**:
- Returning selectors/locators (T018)
- New action tools (T019)
- Full ARIA accessible-name spec compliance — cover the common cases listed below only

**Requirement Refs**:
- FR-004: `ui_get_page_state` returns the current page's DOM/accessibility-relevant state (URL, title, visible elements) to inform the next step
- US-004: inspect current UI state during a flow

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor, 2026-10-30 — provisional per user's "auto, defer confirmations" instruction)
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Dependencies & Reachability

**Depends on**: None

**Entry point**: `ui_get_page_state`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | An `<input>` with `<label for=id>Email</label>` appears with role `textbox` and name `Email` | inputs named by label dropped |
| 2 | An `<input>` wrapped by `<label>Remember me <input type=checkbox></label>` appears with name containing `Remember me` | inputs named by label dropped |
| 3 | An `<input placeholder="Search">` with no label appears with name `Search` | inputs named by placeholder dropped |
| 4 | Name precedence: `aria-label` > `aria-labelledby` > label > text content > placeholder > `title` (> `value`, button-type inputs only; corrected at Stage 4 pre-review, was title above text); an element named by `aria-labelledby` resolves to the referenced element's text | sensible name |
| 5 | `<div role="alert">Password too short</div>` (and `role="status"`, `aria-live` regions with non-empty text) is returned in a new `messages: string[]` field on the success result | alert/error text never reported |
| 6 | Existing behaviour holds: buttons/links still named by text; unnamed + invisible elements still excluded; the no-page error result is unchanged | no regression |
| 7 | Hidden alert regions (zero-size / `display:none`) and empty ones are not reported in `messages` | boundary |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture from the Requirement (label-for input, placeholder input, select, button, alert) | elements include `{textbox, Email}`, `{textbox, Search}`, `{combobox, …}`, `{button, Save}`; `messages` = `["Password too short"]` | automated test in `test/web.test.ts` |
| 2 | Fixture with an empty and a hidden `role=alert` | `messages` is `[]` | automated test |
| 3 | `getPageState(undefined)` | unchanged `{ok:false, error:"No active page — call ui_navigate first"}` | existing test still passes |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T017.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T017.md`.

---

## Approach

**Pattern reference**: `src/tools/web.ts` `getPageState` — keep the single `page.$$eval` pass and the never-throw `{ok, error}` result shape.

**Vital slice**: the name-resolution order inside the `$$eval` callback plus the `messages` collection.
**Cut list**:
- `aria-describedby`, CSS `::before` content, shadow DOM traversal
- Deduplicating repeated identical messages beyond a simple `Set`

Brainstorm Option B: a small in-page `accessibleName(el)` helper evaluated inside the browser, with the precedence of AC4. Use `||`-style emptiness checks (trimmed empty string counts as missing) — the current bug is `??` treating `""` as present. Collect messages with a second `$$eval` over `[role="alert"], [role="status"], [aria-live]:not([aria-live="off"])`, keeping visible, non-empty trimmed `innerText`. Add `messages?: string[]` to the `PageState` interface; update the `ui_get_page_state` tool's text output in `src/server.ts` only if it currently serialises fields explicitly (check — if it stringifies the whole result, no server change is needed).

---

## Edge Case Checklist

- [ ] `aria-labelledby` with multiple IDs → join texts with a space; missing IDs ignored
- [ ] `<label for>` whose `for` contains characters that break a CSS selector → resolve via `document.getElementById`, not `querySelector`
- [ ] Password inputs → name from label/placeholder only, **never** from `value`
- [ ] Text/placeholder longer than ~80 chars → truncate with `…` so page state stays compact
- [ ] Alert that is also an interactive element is not double-counted as an element

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | `getPageState` name resolution + `messages`; `PageState` type |
| `test/web.test.ts` | New fixture + tests for AC1–AC7 |
| `src/server.ts` | Only if `ui_get_page_state` output formatting omits new fields |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/session.ts`, `src/reports/index.ts` | Out of scope; T021 is working in `reports/` in parallel |
| `click`/`fill`/`assertCondition` in `web.ts` | T018/T019 own those |

---

## Test Plan

Test-first (`tdd`): write the AC1–AC7 tests against a `setContent` fixture in `test/web.test.ts` (same pattern as the existing fixture tests), watch them fail on the current code, then fix. Run the verification command. Chromium must launch locally (`npm ci` first if `node_modules` is missing — see MEMORY gotcha).

---

## Completion Checklist

- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T017.md`
- [ ] `npx tsc --noEmit` clean
- [ ] Supervisor notified: task ready for Stage 4 review
