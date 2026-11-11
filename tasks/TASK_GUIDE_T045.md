# TASK_GUIDE — T045: Perf — a compact snapshot builds selectors only when a ref is used
**Date**: 2026-11-11
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P2
**Assigned agent**: backend-developer (implement, test-first)
**Agent guide**: `agents/backend.md`

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `BRAINSTORMING_LOG_snapshot-perf.md` and this guide.)

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`)
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from your role guide
6. Read `BRAINSTORMING_LOG_snapshot-perf.md` (Option A is the chosen path)

---

## Requirement (Pillar 1 — Adapt the requirement)

Seen during T042 verification and confirmed by the user on 2026-11-11 ("let do T045"): `ui_get_page_state` takes 19–31 s on `en.wikipedia.org/wiki/Microsoft` (4,330 interactive candidates). The Supervisor's profile shows about 27 s is verifying a selector for each of the 200 listed elements (about 300 page round trips at 90–120 ms each) and about 2.6 s is taking and disposing one handle per candidate. The compact reply prints no selector.

**Restated intent**:
> A compact `ui_get_page_state` does no per-element selector work: the selector behind a ref is built and verified when the ref is used. The reply text is the same as today, a ref still reaches only the exact element that was listed, and `format: "full"` returns what it returns today.

**Out of scope**:
- Making `format: "full"` faster (it still verifies every selector up front)
- Re-reading an element's role or name when its ref is used
- Lazy selectors for overlays (few per page; they stay as they are)
- Any change to the reply format, the notes, the 200 cap, the scopes or the tool list

**Requirement Refs**:
- FR-004, FR-022: `ui_get_page_state` reports what the agent needs to choose its next step

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed (Supervisor; profile taken 2026-11-11; the two behaviour decisions are flagged to the user in the brainstorm log)
- [x] Domain terms align with `PROJECT_SPEC.md`
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md`

---

## Dependencies & Reachability

**Depends on**: T040, T042, T043 (all merged)

**Entry point**: `ui_get_page_state`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `getPageState` has an option (default: today's behaviour) with which the pass builds no selector for listed elements. `src/server.ts` sets it for the compact format only. | no per-element selector work |
| 2 | With that option, the number of selector-verification round trips (`page.locator(...)` calls) in one snapshot does not depend on the number of listed elements: a 200-element page makes no more than a 5-element page with the same overlays and focus. | no per-element selector work |
| 3 | The compact text for a page is character-for-character what it is today, including the `focused:` line (`@eN` when the focused element is listed, `role "name"` when it is not), overlays, messages and notes. | reply text the same |
| 4 | `resolveRef` on a ref from such a snapshot returns a selector that matches exactly the listed element (verified by element identity at that moment), and returns the same selector on a second call. | built when the ref is used |
| 5 | A ref is stale, with today's message, when the listed node was replaced by a look-alike, removed, or the page navigated; also when no selector can be verified for it. Nothing is done. | reaches only the listed element |
| 6 | A ref to one of several identical siblings still resolves to that same node after the siblings are re-ordered (the decided behaviour change). The existing eager-mode test for this case is not edited. | reaches only the listed element |
| 7 | Without the option (`format: "full"`, and every existing direct caller), the returned struct and the ref behaviour are identical to today's: every existing T040, T042 and T043 test passes unedited. | full format unchanged |
| 8 | The T042 behaviour holds with the option: a snapshot during a re-render returns the settled page; a page that never settles returns within about 2.5 s with the "still changing" note; a stable page takes one pass. | T042 unchanged |
| 9 | The pass does not take one element handle per candidate. At most the listed elements' handles (plus overlays, focus, `within` root) exist after it; everything else is disposed, also when the pass throws or is retaken. | handles |
| 10 | On `en.wikipedia.org/wiki/Microsoft` a compact snapshot takes at most 3 s, and a click by ref right after it succeeds (measured by the Supervisor; 19–31 s before). | the saving |
| 11 | Through MCP: a compact snapshot, then `ui_click` by `@eN`, records the resolved selector (not the ref) in the session's step, as today. | reports unchanged |
| 12 | `npx tsc --noEmit -p tsconfig.json` is clean, the full `npm test` passes, and the tool list stays at or under 20,000 characters. | no regression |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given | Expect | How it's checked |
|---|-------|--------|------------------|
| 1 | Two `data:` pages, 5 and 200 named buttons, snapshot with the option, `page.locator` counted | Same count for both (and it is small) | automated test; must fail on the starting commit |
| 2 | The existing compact fixtures, rendered with and without the option | `renderCompact` output identical | automated test |
| 3 | A focused listed input; a focused element that is not listed | `focused: @eN`; `focused: role "name"` | automated test |
| 4 | Snapshot with the option, then `resolveRef` for every ref, then click one | Each selector matches exactly its element; the click lands on it; a second `resolveRef` returns the same selector | automated test |
| 5 | Node replaced by a look-alike; node removed; navigation | Stale, today's message | automated test |
| 6 | Three identical buttons, snapshot with the option, re-order, click `@e1` | The click lands on the node that was first | automated test |
| 7 | T042's re-render, never-settles and static cases, with the option | Same results as without it | automated test |
| 8 | Through MCP: snapshot, `ui_click` `@eN`, end session | The step in the JSON report carries the selector | automated test (`test/multi-session.test.ts`) |
| 9 | All existing tests | Pass with no edited assertion | `npm test` |

### Verification Command (exact, runnable)

```bash
npx tsc --noEmit -p tsconfig.json && node --import tsx --test test/web.test.ts && npm test
```
`npm test` needs port 8765 free. Criterion 10 is measured by the Supervisor after implementation.

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer in `tasks/TASK_REVIEW_T045.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T045.md`. BEFORE is the Supervisor's per-phase timing of a compact snapshot on the Wikipedia page, on main.

---

## Approach

**Pattern reference**: `src/tools/web.ts` — `snapshotPass` (where selectors are built for `shown`), `RefEntry` / `resolveRef` (where a ref's selector is checked by identity with `locate`), and T043's `viewport` / `within` for how an option reaches the pass.

**Vital slice**: with the option, skip `buildSelector` for listed elements and build it in `resolveRef`.
**Second slice**: one array handle for the candidates instead of `page.$$`.
**Cut list**: faster full format; re-reading role and name at use; lazy overlays.

Option A of the brainstorm, "selectors on demand":

1. **Option**: `getPageState(page, { keepRefs, viewport, within, selectors })`, `selectors` defaulting to `true`. The server passes `selectors: format === "full"`. Pick the final name to match the file's style.
2. **Pass without selectors**: for each shown row, no `buildSelector`; the element is listed with role, name and state. Its ref entry stores the element handle and the row facts `buildSelector` needs. `PageElement.selector` is absent on these elements; make the type say so without changing what the full struct serializes to.
3. **Resolve on use**: `resolveRef` — if the entry already has a selector, today's path, unchanged. Otherwise check the handle is still connected, build the selector for that one element, keep it on the entry, and return it. A build that verifies nothing is the stale error. `buildSelector` needs a way to take the target handle directly; the shared-role-match shortcut is not needed for a single element. Its candidate order and its identity check must not change.
4. **Focus**: with the option, map the focused element to its ref by element identity (its index in the pass), not by comparing selectors, and do not build a selector for it. `renderCompact` prints the same line as today.
5. **T042 signal**: without per-element selectors the pass relies on the `isConnected` check for "moved". Keep that check over every candidate.
6. **Handles**: collect the candidates as one array handle (one `evaluateHandle`), run the read pass and the `isConnected` check over it, and take element handles only for the listed rows in one round trip. In the eager mode the same array can feed `buildSelector`. If this step cannot be done without changing eager-mode behaviour, stop after step 5, report it, and leave `page.$$` in place.
7. Nothing is injected into the page.

---

## Edge Case Checklist

- [ ] `format: "full"` struct is deep-equal to today's on the existing fixtures; no `ref` field appears in it.
- [ ] A ref to a replaced node, a removed node, or after a navigation is stale, with today's message.
- [ ] A ref to one of several identical siblings reaches that node after a re-order.
- [ ] A ref whose selector cannot be verified at use fails as stale; nothing is done.
- [ ] The focused element prints as its `@eN` when listed, as `role "name"` when not; a focused element outside `INTERACTIVE_SELECTOR` still works.
- [ ] `within: "@eN"`, `from` / `to` / `container` refs still resolve (they go through `resolveRefArgs`, unchanged).
- [ ] The T042 re-render and never-settles cases behave the same with the option; an abandoned pass leaves no handles behind.
- [ ] A new snapshot replaces the ref table and disposes the previous one's handles, as today.
- [ ] A closed page does not throw on a ref or a snapshot.
- [ ] `viewport` / `within` scopes, the cap and both notes are unchanged with the option.
- [ ] No named inner functions in Playwright `evaluate` callbacks (tsx `__name` gotcha).
- [ ] Pin-test pre-flight: the `Pre-existing pin tests` row below is filled before work starts
- [ ] Stale references: grep README, RUNBOOK, `site/`, PRD and PROJECT_SPEC for wording that says a ref goes stale when the list is re-ordered or that selectors are verified when the snapshot is taken, and bring it in line

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | option, pass without selectors, array handle, ref entry, `resolveRef` build-on-use, `buildSelector` target argument, focus by identity |
| `src/server.ts` | pass the option in the one `getPageState` call |
| `test/web.test.ts` | Success Criteria 1–7 |
| `test/multi-session.test.ts` | Success Criterion 8 |
| `RUNBOOK.md` (README / PRD / `site/index.html` only where a sentence becomes wrong) | when a ref's selector is built; the re-order behaviour |
| Pre-existing pin tests | `test/web.test.ts` T040 tests call `getPageState(page, { keepRefs: true })` and read `.selector`: they stay on the default (eager) mode and stay unedited, including "after the list is re-ordered every positional ref fails". `test/health.test.ts` tool-list budget: no description change expected. `test/multi-session.test.ts` and `test/dialog-sessions.test.ts` read compact replies through MCP: keep green; if one pins re-order staleness through MCP, report it instead of editing it. |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| The action functions, `resolveRefArgs`, `scopeNote`, `locate` in `src/tools/web.ts` | behaviour must stay identical |
| Tool descriptions and schemas in `src/server.ts` | no contract change; tool-list budget |
| `src/tools/session.ts`, `src/reports/index.ts`, `src/api/run-test.ts`, `src/stdio.ts` | unrelated |
| `docs/experiments/` | the Supervisor measures |
| `.claude/`, `skills/`, `agents/`, `scripts/` | harness |

---

## Test Plan

1. Tests first for Success Criteria 1–8; see criterion 1 fail on the starting commit.
2. Existing tests stay green with no edited assertion (criterion 9).
3. Full `npm test`; `tsc --noEmit`.
4. Supervisor measures criterion 10 and reruns the four baseline flows and the saucedemo repro.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T045.md`'s Evidence table
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in the running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
