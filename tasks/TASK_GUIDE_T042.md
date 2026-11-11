# TASK_GUIDE — T042: Bug — a page-state snapshot taken while the page re-renders comes back empty
**Date**: 2026-11-11
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: backend-developer (implement, test-first)
**Agent guide**: `agents/backend.md`

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md` and this guide.)

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`)
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from your role guide

---

## Requirement (Pillar 1 — Adapt the requirement)

Found in the 2026-11-11 token baseline run and confirmed by the user's "continue to clean the pending tasks": `ui_get_page_state` called straight after a click that changes the page returns `ok` with **0 elements**. The agent then sees an empty page and either gives up or guesses selectors.

Reproduced 5 of 5 times by the Supervisor on saucedemo.com (login click, cart link, continue-shopping), each time 50–110 ms after the click; the same call 800 ms later lists 7–30 elements.

**Diagnosis (verified by the Supervisor, in-process probe)**:
- These clicks are client-side route changes: `document.readyState` is `complete` throughout and no `load` event fires, so waiting for a load state cannot help.
- At the moment of the empty snapshot the DOM still held 8 buttons. `getPageState` takes its element handles with `page.$$`, then reads them and verifies a selector for each; the framework replaces the DOM while that runs. The handles go stale: they report zero size, or `buildSelector` cannot verify them and drops them ("element vanished mid-read; omit rather than guess"). Every element is dropped, and the reply is a silent, successful, empty list.

**Restated intent**:
> A snapshot taken while the page is re-rendering returns the page as it is once it has settled, not an empty or half-empty list. If the page never settles within a short budget, the reply says so instead of looking like a quiet empty page.

**Out of scope**:
- Waiting after every click or navigation (the fix belongs in the snapshot, where the instability is observed)
- A general "wait for network idle"
- Any change to refs, the compact format or selector building rules

**Requirement Refs**:
- FR-004, FR-022: `ui_get_page_state` reports what the agent needs to choose its next step

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed (Supervisor; bug reproduced and diagnosed 2026-11-11)
- [x] Domain terms align with `PROJECT_SPEC.md`
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md`

---

## Dependencies & Reachability

**Depends on**: None

**Entry point**: `ui_get_page_state`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | When listed elements are detached from the document during the snapshot, `getPageState` takes the snapshot again, and returns the settled page's elements. | settled page, not empty |
| 2 | Retrying is bounded: at most about 2 seconds in total. If elements are still vanishing at the end, the result is returned with a `note` that the page was still changing and to call `ui_get_page_state` again; it is never an unexplained empty list. | says so if it never settles |
| 3 | A stable page takes exactly one pass: no added wait, no extra page round trips beyond one cheap stability check. | no cost on the normal path |
| 4 | Refs point at the final pass only: handles of abandoned passes are disposed, and `@eN` of the returned list resolves to the listed elements. | refs unchanged |
| 5 | A page that is genuinely empty (no interactive elements) still returns an empty list at once, with no note. | no false alarm |
| 6 | `format: "full"`, the 200-element cap note, overlays, focus and messages behave as before. An existing cap note and the new note can both appear. | nothing else changes |
| 7 | `npx tsc --noEmit -p tsconfig.json` is clean and the full `npm test` passes. | no regression |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given | Expect | How it's checked |
|---|-------|--------|------------------|
| 1 | A page whose script replaces its whole list of buttons several times over about 300 ms, snapshot requested while that runs | The reply lists the final buttons (non-empty) | automated test; must fail on the starting commit |
| 2 | A page that replaces its buttons every 20 ms forever | Reply within about 2.5 s, carrying the "still changing" note | automated test |
| 3 | A static page | One pass (assert through an exported pass counter or by timing well under the retry delay) | automated test |
| 4 | Case 1, then `resolveRef` for each returned ref | Each resolves to its listed element | automated test |
| 5 | A page with no interactive elements | Empty list, no note, returns at once | automated test |
| 6 | saucedemo: click login, snapshot immediately | 30 or so elements, not 0 | Supervisor reruns the repro script |

### Verification Command (exact, runnable)

```bash
npx tsc --noEmit -p tsconfig.json && node --import tsx --test test/web.test.ts && npm test
```
`npm test` needs port 8765 free.

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer in `tasks/TASK_REVIEW_T042.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T042.md`. BEFORE is the Supervisor's repro output on main (0 elements straight after each click).

---

## Approach

**Pattern reference**: `src/tools/web.ts` `getPageState` — the existing "visible" / "vanished mid-read" handling; and `waitForCondition` in the same file for a bounded polling loop.

**Vital slice**: detect "elements vanished during this pass" and retry within a budget.
**Cut list**: mutation observers or any script left in the page; waiting after clicks; network-idle waits; a configurable budget.

Supervisor's decision (Low risk, no brainstorm log):

1. Split the body of `getPageState` into one pass that also reports whether the page moved under it. "Moved" means: a handle taken at the start of the pass is no longer connected to the document at the end of it (one `evaluate` over the handles returning `isConnected` counts), or `buildSelector` returned undefined for an element that was visible. Do not count elements that were simply invisible from the start.
2. If the pass moved, wait a short interval (about 100 ms) and run the pass again, until a pass does not move or the budget (about 2 s) is spent. Return the last pass; add the note when it still moved.
3. Dispose every handle of an abandoned pass. Only the returned pass installs the ref table (`keepRefs`), exactly as today.
4. Nothing is injected into the page; the stability check reads `isConnected` only.

Keep the public signature and the struct. `note` already exists on `PageState`; if both notes apply, join them into the one field.

---

## Edge Case Checklist

- [ ] The retry must not loop on a page with a ticking clock or animation that does not detach listed elements: only detached or unverifiable listed elements count.
- [ ] A navigation that destroys the execution context mid-pass (handles throw) is treated as "moved" and retried, not returned as an error, unless the budget is spent.
- [ ] A closed page still returns an error promptly, without retrying.
- [ ] Handles from abandoned passes are disposed; the ref table is replaced only by the returned pass.
- [ ] A held native dialog behaves as before (the guard runs before the snapshot).
- [ ] The total added time on an unstable page is bounded (about 2 s), below typical tool timeouts.
- [ ] The compact renderer prints the note on one line (it already collapses line breaks).
- [ ] No named inner functions in Playwright `evaluate` callbacks (tsx `__name` gotcha).
- [ ] Pin-test pre-flight: the `Pre-existing pin tests` row below is filled before work starts
- [ ] Stale references: grep README, RUNBOOK and `site/` for advice to "wait" or "call again" after a click and bring it in line only if this change makes it wrong

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | pass + bounded retry inside `getPageState` |
| `test/web.test.ts` | the five automated cases |
| `RUNBOOK.md` | one failure-mode row for the "still changing" note |
| `docs/experiments/token-baseline.mts` | not by the implementer; the Supervisor removes the 800 ms workaround after the fix |
| Pre-existing pin tests | `test/web.test.ts` T040 tests assert ref numbering and the 200-cap note text; `test/multi-session.test.ts` reads compact replies. Handling: keep green, no repointing expected. |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/server.ts` | the tool handler and descriptions do not change (and the tool list has a size budget) |
| `buildSelector`, `resolveRef`, `renderCompact`, the action functions in `src/tools/web.ts` | behaviour must stay identical |
| `src/tools/session.ts`, `src/reports/index.ts`, `src/api/run-test.ts`, `src/stdio.ts` | unrelated |
| `.claude/`, `skills/`, `agents/`, `scripts/` | harness |

---

## Test Plan

1. Write the re-rendering test first and see it fail on the starting commit (empty or short list).
2. Add the never-settles, static, refs and empty-page cases.
3. Full `npm test`; `tsc --noEmit`.
4. Supervisor reruns the saucedemo repro and the four baseline flows without the 800 ms wait.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T042.md`'s Evidence table
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in the running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
