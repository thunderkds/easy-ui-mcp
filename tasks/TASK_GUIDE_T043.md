# TASK_GUIDE — T043: Snapshot scope — `viewport` and `within` for `ui_get_page_state`
**Date**: 2026-11-11
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P2
**Assigned agent**: backend-developer (implement, test-first)
**Agent guide**: `agents/backend.md`

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `BRAINSTORMING_LOG_snapshot-scope.md` and this guide.)

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`)
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from your role guide
6. Read `BRAINSTORMING_LOG_snapshot-scope.md` (Option A is the chosen path)

---

## Requirement (Pillar 1 — Adapt the requirement)

From the low-token plan and the 2026-11-11 baseline: content-heavy pages still cost 1,000–1,600 tokens per snapshot after T040, and listing only what is in the viewport roughly halves that. The user asked on 2026-11-11 to "continue to clean the pending tasks"; T043 is one of them.

**Restated intent**:
> An agent can ask `ui_get_page_state` for only the elements on screen (`viewport: true`) or only those inside one element (`within`), and the reply says it is scoped and how many elements were left out. With neither argument the reply is exactly what it is today.

**Out of scope**:
- Scoping by default, or automatically above a size threshold
- Scoping to the topmost modal automatically
- Paging (`offset` / `limit`)
- Scoping `overlays`, `focused` or `messages`

**Requirement Refs**:
- FR-004, FR-022: `ui_get_page_state` reports what the agent needs to choose its next step

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed (Supervisor; opt-in and both scopes decided by the Supervisor on 2026-11-11 and flagged to the user)
- [x] Domain terms align with `PROJECT_SPEC.md`; new term: **scope**
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md`

---

## Dependencies & Reachability

**Depends on**: T042 — its retry restructures `getPageState`; this task builds on the merged result

**Entry point**: `ui_get_page_state`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | With neither argument, the reply (compact and full) is identical to the reply before this task for the same page. | default unchanged |
| 2 | `viewport: true` lists only elements whose bounding rect intersects the current viewport (partly visible counts), at the current scroll position. | only what is on screen |
| 3 | `within` takes a CSS / Playwright selector or an `@eN` / `@oN` ref of exactly one element and lists only elements inside it. Zero or several matches, or a stale ref, is an error and nothing is listed. | only inside one element |
| 4 | Both arguments can be combined; an element must satisfy both. | scopes compose |
| 5 | A scoped reply whose scope left elements out carries a note with the shown and total counts and the scope used, e.g. `Showing 37 of 180 elements (viewport only); scroll, or call without viewport, for the rest`. When nothing was left out there is no scope note. | says it is scoped |
| 6 | The 200-element cap applies after scoping. When it still cuts the list, its note is present as well; its text mentions `viewport` / `within` as ways to narrow the list. | cap no longer hides in-scope elements |
| 7 | Refs number the returned list and each resolves to its listed element (T040 rule unchanged). | refs unchanged |
| 8 | `overlays`, `focused` and `messages` are not filtered; a focused element outside the scope prints as `role "name"`. | page-wide facts stay |
| 9 | The `tools/list` tools array stays at or under 20,000 characters, with the two arguments described. | tool-list budget |
| 10 | On the baseline's content pages, a `viewport: true` snapshot is at most 65% of the unscoped one in characters (measured by the Supervisor on Wikipedia and Hacker News). | the saving |
| 11 | README, RUNBOOK, `site/index.html` and PRD (FR-004 / FR-022) describe the two arguments and the note. | docs match |
| 12 | `npx tsc --noEmit -p tsconfig.json` is clean and the full `npm test` passes. | no regression |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given | Expect | How it's checked |
|---|-------|--------|------------------|
| 1 | A tall page: 3 buttons at the top, 3 far below the fold | No argument: 6 lines. `viewport: true`: the top 3 and the note "3 of 6". After scrolling to the bottom: the bottom 3 | automated test |
| 2 | A button straddling the viewport edge | Listed with `viewport: true` | automated test |
| 3 | A page with a form `#f` (2 inputs) and 4 links outside it | `within: "#f"`: the 2 inputs and the note "2 of 6"; `within` as the ref of a listed container works the same | automated test |
| 4 | `within: ".missing"`, `within` matching 2 elements, `within` a stale ref | Error naming the problem; no list | automated test |
| 5 | `within` an element with no interactive descendants | Empty list with the scope note, no error | automated test |
| 6 | 250 buttons, 30 of them in the viewport | `viewport: true`: 30 lines, scope note, no cap note. No argument: 200 lines and the cap note | automated test |
| 7 | Any scoped snapshot | Each returned ref resolves to its listed element | automated test |
| 8 | Fixture pages from the existing tests, no arguments | Replies deep-equal the pre-change ones | automated test (existing tests stay green) |
| 9 | `tools/list` | ≤ 20,000 characters | existing budget test |

### Verification Command (exact, runnable)

```bash
npx tsc --noEmit -p tsconfig.json && node --import tsx --test test/web.test.ts && npm test
```
`npm test` needs port 8765 free. Criterion 10 is measured by the Supervisor after implementation.

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer in `tasks/TASK_REVIEW_T043.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T043.md`. BEFORE is the size of unscoped snapshots on the baseline's content pages and the reply to `ui_get_page_state` with `viewport: true` on the starting commit.

---

## Approach

**Pattern reference**: `src/tools/web.ts` `getPageState` — the one `evaluate` pass that already reads each candidate's bounding rect and state; and T040's `keepRefs` option for how an option reaches that function.

**Vital slice**: `viewport: true` as a filter in the read pass, with the note.
**Cut list**: automatic scoping; topmost-modal scoping; paging; scoping overlays, focus or messages.

Option A of the brainstorm, "opt-in filters":

1. `getPageState(page, { keepRefs, viewport, within })`. Candidates are still collected page-wide (the positional fallback selector indexes that list). The read pass gains an in-scope flag per candidate: rect intersects the viewport, and/or the `within` root contains it. Filter on it before the 200 cap and before selectors are built.
2. `within` is resolved to one element first (reuse the existing exactly-one-match check); failure is an error result, not an empty list. Add `within` to `REF_ARGUMENTS` so a ref is resolved in `registerSessionTool` like any selector argument.
3. Counts for the note: total = visible named candidates page-wide; shown = those in scope (before the cap).
4. `src/server.ts`: two optional arguments with short descriptions; keep the description text tight because of the tool-list budget.
5. Nothing is injected into the page.

---

## Edge Case Checklist

- [ ] No arguments: the reply is identical to today's for the same page.
- [ ] `within` that matches no element, several elements, or a stale ref fails clearly and lists nothing.
- [ ] `within` an element with no interactive descendants returns an empty list with the scope note, not an error.
- [ ] `viewport: true` on a page scrolled halfway lists what is on screen now.
- [ ] An element partly inside the viewport counts as inside.
- [ ] The 200 cap applies after scoping; both notes can appear together, on one `note` line.
- [ ] Refs number the returned (scoped) list, and each resolves to its listed element.
- [ ] `format: "full"` honours the same scope arguments.
- [ ] The focused element outside the scope is still reported as `role "name"`.
- [ ] The tool list stays at or under 20,000 characters.
- [ ] The T042 retry still works with a scope; a `within` root that vanishes mid-pass ends as an error or a "still changing" note, never as a quiet empty list.
- [ ] The `within` root itself is listed only if it is an interactive element inside itself by the normal rules (it is not: "inside" means descendants).
- [ ] No named inner functions in Playwright `evaluate` callbacks (tsx `__name` gotcha).
- [ ] Pin-test pre-flight: the `Pre-existing pin tests` row below is filled before work starts
- [ ] Stale references: grep README, RUNBOOK, `site/` and PRD for the cap note wording "use a CSS selector for the rest" and bring it in line

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | scope options, filter, notes, `within` in `REF_ARGUMENTS` |
| `src/server.ts` | two arguments on `ui_get_page_state`; description words |
| `test/web.test.ts` | scope tests |
| `test/multi-session.test.ts` | one MCP-level test: `viewport` and `within` (selector and ref) through the tool |
| `README.md`, `RUNBOOK.md`, `site/index.html`, `PRD.md` | document the arguments and the note |
| Pre-existing pin tests | `test/health.test.ts` pins the tool list at 20,000 characters: stay under it. `test/web.test.ts` T040 test pins the cap note text ("Showing first 200 of …"): repoint if the wording changes. `test/site.test.ts` pins docs-site strings: keep green. |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `buildSelector`, `resolveRef`, `renderCompact`, the action functions in `src/tools/web.ts` | behaviour must stay identical (`renderCompact` already prints `note`) |
| `src/tools/session.ts`, `src/reports/index.ts`, `src/api/run-test.ts`, `src/stdio.ts` | unrelated |
| `docs/experiments/` | the Supervisor measures |
| `.claude/`, `skills/`, `agents/`, `scripts/` | harness |

---

## Test Plan

1. Tests first for Success Criteria 1–7 on `data:` pages; see them fail.
2. Existing tests stay green (criterion 8); budget test (criterion 9).
3. Full `npm test`; `tsc --noEmit`.
4. Supervisor measures criterion 10 on Wikipedia and Hacker News and reruns the four baseline flows.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T043.md`'s Evidence table
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in the running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
