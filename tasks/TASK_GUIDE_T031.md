# TASK_GUIDE — T031: Close and answer — click outside, `ui_click` options, native dialogs
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
7. Read `BRAINSTORMING_LOG_browser-actions.md` — rows A1–A5, D3, D4

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-11-10): "some actions we can not do… like the Esc press, the click outside the backdrops". Escape already works (`ui_press_key`, T019). The audit confirmed the rest:
- `ui_click` clicks the element's centre (`src/tools/web.ts:62`). A backdrop's centre is covered by the dialog panel, so the click times out after 5s ("element intercepts pointer events").
- A native `<dialog>`'s `::backdrop` isn't an element at all.
- No double-click, right-click or modifier click.
- No `page.on("dialog")` anywhere. Playwright cancels every native `alert`/`confirm`/`prompt`/`beforeunload` silently. So `confirm()` always returns false, "Delete? OK" flows can never be accepted, and the message is lost from the report.

**Restated intent**:
> The agent can close overlays the way users do (Escape or click outside), click in every way a user clicks, and decide how native browser dialogs are answered. Every dialog that appears is visible in the report.

**Out of scope**:
- Drag, long-press, touch (T033 / later)
- Coordinate-only clicks with no element reference
- Overlay detection (T030)

**Requirement Refs**:
- FR-002: primitive action tools (extended)
- FR-023 (new, added by this task): click outside an element; click with button/count/modifiers/position/force; native dialogs logged and answerable
- US-002

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed by the user (2026-11-10)
- [x] Decision D1 answered by the user (2026-11-10)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] FR-023 added to `PRD.md` and covered by the Acceptance Criteria

### Decisions

| # | Question | Answer |
|---|----------|--------|
| D1 | A native dialog appears and the agent did not call `ui_dialog` first: what happens? | **Ask the agent** (user, 2026-11-10: "can we ask the agent again for the exact action"). The dialog stays open. The tool call that opened it returns at once and says which dialog is waiting. The agent then answers with `ui_dialog`. A safety timeout dismisses it only if the agent never answers. |

**Why this works:** a native dialog blocks the page until it is answered. The browser does not answer it for us when we have a listener. Playwright documents that the action that opened the dialog (e.g. `locator.click()`) stalls until the dialog is handled. So the server must not wait on that action. It races the action against a "dialog opened" signal and returns to the agent as soon as either finishes.

---

## Dependencies & Reachability

**Depends on**: none. **Soft**: T030 (`overlays` lets the agent and the live check see the overlay close; unit tests check the DOM directly).
**Coordinate with**: T029 (multiple sessions). The dialog listener is per session page; new tools take the optional `session_id` if T029 has merged.

**Entry point**: MCP tools `ui_click_outside`, `ui_click`, `ui_dialog`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_click_outside(selector)` clicks a viewport point outside the single matching element's bounding box, choosing a point whose `elementFromPoint` is not inside that element and not an interactive control; success text and report name the element that was hit | click outside the backdrop |
| 2 | A modal closed by outside click (fixture: div backdrop with click handler; native `<dialog>` with backdrop-click handler) is closed after `ui_click_outside` | click outside |
| 3 | No safe point (element covers the viewport, or every candidate is an interactive control) → `isError` that says so and suggests `ui_press_key` with `Escape` | clear failure |
| 4 | `ui_click` gains optional `button` (`left`/`right`/`middle`), `clickCount` (1–3), `modifiers` (`Alt`/`Control`/`Meta`/`Shift`/`ControlOrMeta`), `position {x,y}` (offset inside the element), `force` (boolean). Without them it behaves exactly as today | every way a user clicks |
| 5 | Fixture proves each option: `dblclick` fires, `contextmenu` fires, Shift-click carries `shiftKey`, `position` hits the corner, `force` clicks an element under a transparent overlay | each option works |
| 6 | Report sentence includes the options used (e.g. `Right-clicked "#row-3"`, `Double-clicked …`, `Clicked "#x" (forced)`) | truthful report |
| 7 | Every session page registers a dialog listener that **holds** an unanswered dialog open. Each dialog is logged as an action with type, message, the answer and who answered (`agent`, `pre-set`, or `timeout`) | dialogs visible in report |
| 8 | When a dialog opens during any tool call (`ui_click`, `ui_press_key`, `ui_navigate`, `ui_fill`…), that call returns within ~1s, not after its own timeout. It is a success (not `isError`) whose text says: `Browser is waiting on a <type> dialog: "<message>". Answer with ui_dialog accept or dismiss (prompt: add text).` (prompt also shows its default value) | ask the agent |
| 9 | `ui_dialog(action: "accept"|"dismiss", text?)` answers the waiting dialog; `text` fills a `prompt`. The action that opened it then finishes, and the response reports what happened next (e.g. the URL after a confirmed delete-and-redirect) | exact action from the agent |
| 10 | While a dialog is waiting, every other tool except `ui_dialog`, `ui_end_session` and `ui_step` returns `isError`: `A <type> dialog is waiting: "<message>" — answer it with ui_dialog first`. This is **not** a hard session failure | page is blocked, say so |
| 11 | `ui_dialog` with no dialog waiting **pre-sets** the answer for the next dialog. The next dialog is then answered at once and does not pause. This keeps scripted flows (and REST `/api/run-test`) able to run without a round trip | scripted flows |
| 12 | Safety timeout: a dialog left waiting for `DIALOG_TIMEOUT_MS` (default 120 000, env-overridable) is dismissed (`alert` accepted), logged as `timeout`, and reported on the next tool response. `ui_end_session` dismisses any waiting dialog before closing | never freeze forever |
| 13 | `beforeunload` ("Leave site?") during `ui_navigate` / reload is asked the same way; accept = leave, dismiss = stay | unsaved-changes guard |
| 14 | Legacy no-session page uses the same rules | consistency |
| 15 | Docs list the new tools/options and explain the "dialog waiting → ui_dialog" loop; the doc-drift test passes | agent guidance |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Fixture: fullscreen backdrop with centred panel; backdrop click closes it | `ui_click(backdrop)` fails today; `ui_click_outside(panel)` closes it | `test/web.test.ts` |
| 2 | Fixture: `<dialog>` via `showModal()`, closes on backdrop click | `ui_click_outside("dialog")` closes it | `test/web.test.ts` |
| 3 | Element sized 100vw×100vh | `isError` mentioning Escape | `test/web.test.ts` |
| 4 | Button that calls `confirm("Delete?")` and writes the result to the DOM; `ui_click` it | click returns in < 2s with the "waiting" text; `ui_get_page_state` now → `isError` "dialog is waiting"; `ui_dialog accept` → page shows `true`; report logs `answered by agent` | `test/session.test.ts` |
| 5 | Same button, `ui_dialog dismiss` | page shows `false` | `test/session.test.ts` |
| 6 | `prompt("Name?")` → `ui_dialog accept text="Ann"` | page receives `"Ann"` | `test/session.test.ts` |
| 7 | `ui_dialog accept` **before** clicking | no pause, page shows `true`, logged `pre-set`; the following dialog asks again | `test/session.test.ts` |
| 8 | `DIALOG_TIMEOUT_MS=500`, click, wait 1s, call `ui_get_page_state` | dialog dismissed, logged `timeout`, response mentions it | `test/session.test.ts` |
| 9 | `alert("Hi")` on page load during `ui_navigate` | navigate returns the waiting text; `ui_dialog accept` → navigate result (URL, title) | `test/session.test.ts` |
| 10 | `describe()` for each new action/option | readable, escaped | `test/reports.test.ts` |
| 11 | Live: rebuilt container, Claude Code closes a real modal by outside click; clicks a delete button, is asked about the confirm, accepts it | report shows both, with `answered by agent` | Stage 5 `verify` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts && node --import tsx --test test/session.test.ts && node --import tsx --test test/reports.test.ts && node --import tsx --test test/docs-tools.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T031.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T031.md`.

---

## Approach

**Brainstorming**: done — `BRAINSTORMING_LOG_browser-actions.md`, Option B, approved 2026-11-10.

**Pattern reference**:
- New tools follow `runInteraction` + `onUniqueLocator` (T019 shape). Names go in the `TOOL` map in `src/server.ts` and get `describe()` cases in `src/reports/index.ts`.
- Session-level listeners: copy `attachIssueListeners()` in `src/tools/session.ts:139`.

**Vital slice**:
- `clickOutside()` = bounding box → candidate points (centres of the four margins, then corners) → first one where `elementFromPoint` is outside the element and non-interactive → `page.mouse.click`.
- Pass the `ui_click` options straight to `locator.click`.
- Per page, keep a `DialogState` with `pending?: {dialog, type, message, openedAt, action: Promise}`, `preset?: {action, text}` and `notices: string[]`.
  - The listener uses the preset if there is one. Otherwise it stores `pending` and starts the safety timer.
- One wrapper, `withDialogGuard(page, run)`, used by `runInteraction` and by `ui_navigate`/`ui_click`/`ui_fill`:
  - If a dialog is pending, refuse.
  - Otherwise `Promise.race([run(), dialogOpened])`.
  - If the dialog won, keep the action promise in `pending.action` and return the "waiting" text.
- `ui_dialog` answers `pending.dialog`, awaits `pending.action` (with a short cap), then returns its result.

**Cut list**:
- Answering several queued dialogs ahead of time (one preset only)
- `ui_click_outside` with explicit side or point
- Hover-with-modifiers

---

## Edge Case Checklist

- [ ] Candidate point lands on a *different* overlay's control → skip it, never click a control by accident
- [ ] Element partly off-screen → only consider points inside the viewport
- [ ] `force: true` skips actionability → report must say "forced"
- [ ] `position` outside the element's box → Playwright error passed through, not a silent click elsewhere
- [ ] Dialog opened from inside `ui_click` → the click returns the "waiting" text; the stalled action promise is kept, never awaited without a cap, and its late error (if any) is logged, not thrown
- [ ] Two dialogs in a row (confirm, then alert) → `ui_dialog` answers the first and its response says the second is now waiting
- [ ] Preset used once; the following dialog asks again
- [ ] Dialog opened by a timer with no tool call running → the next tool call is refused with the "waiting" text (AC 10)
- [ ] `ui_get_page_state` / `ui_assert` would hang on a blocked page → they are refused, never run
- [ ] Safety timer cleared on answer and on `ui_end_session`
- [ ] Session timeout (`SESSION_TIMEOUT_MS`) with a waiting dialog → dismissed before close
- [ ] Dialog message with HTML → escaped in the report
- [ ] Listener removed on `ui_end_session` / context close

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | `clickOutside()`, `click()` options |
| `src/tools/session.ts` | dialog listener + next-answer slot + notice queue |
| `src/server.ts` | `ui_click_outside`, `ui_dialog`, `ui_click` schema, notice line on responses, legacy-page listener |
| `src/reports/index.ts` | `describe()` cases |
| `test/web.test.ts`, `test/session.test.ts`, `test/reports.test.ts`, `test/docs-tools.test.ts` | AC tests |
| `PRD.md` | FR-023 |
| `AGENTS.md`, `HARNESS.md`, `README.md`, `RUNBOOK.md`, `site/index.html` | tool list + count |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `isFatalOutcome` | dialogs are logged, never fail a session by themselves |
| `resolveUniqueLocator` | shared exactly-one-match contract |
| `src/api/run-test.ts` | REST shape unchanged |

---

## Test Plan

Test-first with `setContent` fixtures for each AC. Dialog tests through the session API so the listener is the real one. Run the verification command, then live drive on a spare port (memory: "MCP drive on a spare port") and on the rebuilt container.

---

## Completion Checklist

- [x] D1 answered (ask the agent)
- [x] Implementation done
- [x] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T031.md`
- [ ] Security review run (Medium risk)
- [x] Docs updated (AC 15), FR-023 in `PRD.md`
- [ ] Supervisor notified: task ready for Stage 4 review
