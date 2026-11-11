# TASK_GUIDE — T041: Trim the tool list (descriptions and repeated schema text)
**Date**: 2026-11-11
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: backend-developer (implement, test-first), qa-expert (independent verify)
**Agent guide**: `agents/backend.md`

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `docs/experiments/token-baseline-2026-11-11.md` and this guide.)

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

User, 2026-11-11: the low-token plan asks to "review tool schemas" and slim them where possible while staying an MCP server; after the baseline experiment the user said "do T041 after" T040.

The baseline measured the `tools/list` reply at 26,821 characters (about 6,705 tokens) for 26 tools; after T040 it is 27,207 characters (the breakdown below is from the baseline). That is 76–83% of an app-style flow. Where the characters go:

| Part | Characters |
|------|-----------|
| Tool descriptions | 10,317 |
| Argument descriptions (without `session_id`) | 4,104 |
| `session_id` argument, repeated on 25 tools | 4,350 |
| `title` (same as the name) | 301 plus keys |
| SDK-generated (`$schema`, `execution`, …) | about 3,400 |

**Restated intent**:
> The tool list costs clearly fewer tokens, and an agent reading it still learns everything it needs to call each tool correctly. No tool is removed, renamed or regrouped, and no argument changes.

**Out of scope**:
- Removing, merging, renaming or hiding tools; changing any argument name, type or default
- Changing SDK-generated schema parts (`$schema`, `execution`)
- Any behaviour change in a handler
- Rewriting README / RUNBOOK / docs-site prose beyond strings a pin test forces

**Requirement Refs**:
- FR-002, FR-019: the primitive tools stay as they are
- FR-021: `session_id` keeps its meaning

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor; user approved T041 on 2026-11-11)
- [x] Domain terms align with `PROJECT_SPEC.md`
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md`

---

## Dependencies & Reachability

**Depends on**: T040 — its ref wording in `ui_get_page_state` and the selector descriptions must be merged first (same lines of `src/server.ts`)

**Entry point**: `tools/list`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `JSON.stringify` of the `tools/list` tools array is at most 20,000 characters (about 5,000 tokens; at least 26% below the 27,207 it is after T040). A test pins this budget so later tasks cannot grow it silently. | costs fewer tokens |
| 2 | The same 26 tool names are listed, and for every tool the argument names, types, enums, numeric limits and `required` lists are identical to before the change. | nothing removed or changed |
| 3 | Every fact in the "Facts that must survive" list below is still stated somewhere in the tool list, at least once, on the tool where an agent would look for it. | agent still learns what it needs |
| 4 | The `session_id` argument description is one short phrase; the full rule (optional with one open session, required with several, returned by `ui_start_session`) is stated once, in `ui_start_session`. | repeated text removed |
| 5 | The positional-selector (`nth=`) and ref staleness rules are stated once, in `ui_get_page_state`, not on every selector tool. | repeated text removed |
| 6 | `npx tsc --noEmit -p tsconfig.json` is clean and the full `npm test` passes. | no regression |

### Facts that must survive (oracle for criterion 3)

The Supervisor fixes this list before implementation; the implementer may not shorten it.

1. `ui_start_session`: returns a session id; several sessions per connection (cap 3 by default); an unused session closes after 10 minutes; optional `device`, `viewport`, `colorScheme`, `locale`, `timezoneId`; default 1280x720 desktop; native dialogs are held for the agent during a session.
2. `ui_end_session`: closes the session and writes the JSON and HTML report.
3. `ui_step`: labels the actions that follow, for the report.
4. `ui_assert` fails the session; `ui_check` records a soft result and never fails it; `ui_wait_for` polls until the condition holds or the timeout (max 60,000 ms) and a timeout fails the session. Each takes a JS expression evaluated in the page.
5. `ui_get_page_state`: compact lines with refs by default; `format: "full"` for JSON with selectors; at most 200 elements; state lists non-default fields only; a password value is never returned; overlays and focus are reported; refs are valid only for the latest snapshot; to read text use `ui_get_text`.
6. Selector arguments accept a ref from `ui_get_page_state` or a CSS / Playwright selector, and must match exactly one element.
7. `ui_click`: `button`, `clickCount`, `modifiers`, `position`, `force`; a click that opens a native dialog returns "waiting", answered with `ui_dialog`.
8. `ui_click_outside`: closes an overlay the way a user does.
9. `ui_dialog`: `accept` / `dismiss`, optional `text` for a prompt.
10. `ui_fill` replaces the value at once; `ui_type` types key by key (optional `delayMs`, max 500) for inputs that react per keystroke.
11. `ui_scroll`: element into view with `selector`; otherwise one viewport step in `direction`; `container` for a scroll area; the reply says when the end is reached.
12. `ui_get_text`: one element or the whole body; cut at 4,000 characters; fails on zero, several or invisible matches.
13. `ui_take_screenshot`: `selector`, `fullPage`, `inline` (image returned in the reply, size-capped); saved to the reports folder.
14. `ui_upload_file`: uploads the one built-in PNG; no path argument.
15. `ui_get_logs`: console, page errors, failed requests and HTTP errors; `since`, `level`.
16. `ui_tabs`: list / switch / close; a new tab is announced in the next reply.
17. `ui_set_viewport`: whole pixels within the allowed range. `ui_navigate_history`: back / forward / reload. `ui_press_key`: optional selector. `ui_drag`: `from` onto `to`. `ui_select_option`, `ui_set_checked`, `ui_hover`: what each does.

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given | Expect | How it's checked |
|---|-------|--------|------------------|
| 1 | The server's `tools/list` reply | Tools array serializes to ≤ 20,000 characters | automated test (new budget test) |
| 2 | A snapshot of names, argument names, types, enums, limits, `required` taken on the pre-change commit | Identical after the change | automated test or a scripted diff pasted in the report |
| 3 | The 17 facts above | Each found in the tool list by the reviewer | qa-expert reads the new list against the oracle |
| 4 | The four baseline flows | Still pass in "after" mode | Supervisor/QA rerun of `docs/experiments/token-baseline.mts` |

### Verification Command (exact, runnable)

```bash
npx tsc --noEmit -p tsconfig.json && npm test
```
`npm test` needs port 8765 free.

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer in `tasks/TASK_REVIEW_T041.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T041.md`. BEFORE is the size of the `tools/list` tools array on the commit this task starts from (after T040), captured before the first implementation commit.

---

## Approach

**Pattern reference**: `src/server.ts` `SELECTOR_DESCRIPTION` / `NTH_NOTE` / `sessionIdShape` — shared strings already exist; shorten them at the source instead of editing 25 call sites.

**Vital slice**: shorten `sessionIdShape`'s description, remove `NTH_NOTE` from every tool but `ui_get_page_state`, and tighten the ten longest tool descriptions.
**Cut list**: dropping `title`; touching SDK-generated schema; tool grouping; a generated description file.

Order of work, cheapest first:
1. `sessionIdShape` description → one phrase (about 2,700 characters saved).
2. `NTH_NOTE` → stated once in `ui_get_page_state` (about 1,500 saved).
3. Tool descriptions: one or two sentences each — what it does, then only the non-obvious rule. Remove restated argument lists where the argument's own description already says it, and remove examples that repeat the argument description.
4. Argument descriptions: drop ones that restate the name (`value`: "The value to fill into the input").

Write the budget test first; it fails at 27,207 and passes when the work is done. Put the size check where the existing MCP-level tests already list tools.

---

## Edge Case Checklist

- [ ] A shortened description must not drop a safety or limit fact from the oracle list (60,000 ms, 4,000 characters, 200 elements, 500 ms, password never returned).
- [ ] `test/docs-tools.test.ts` scans literal `registerTool` / `registerSessionTool` calls and the "all 26 tools" count: both stay true.
- [ ] `test/site.test.ts` pins docs-site strings, not tool descriptions: confirm nothing there quotes a description being changed.
- [ ] Tests that assert on a description or error wording (grep `test/` for the strings being removed) are repointed, not deleted.
- [ ] No argument gains or loses a description that changes its JSON schema type.
- [ ] Pin-test pre-flight: the `Pre-existing pin tests` row below is filled before work starts
- [ ] Stale references: grep README, RUNBOOK, `site/`, PROJECT_SPEC for "6,705", "26,821" and any quoted description text

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/server.ts` | shorter shared strings and tool/argument descriptions only |
| `test/health.test.ts` or the MCP-level test that lists tools | new budget test (≤ 20,000 characters) and the unchanged-schema check |
| `docs/experiments/token-baseline-2026-11-11.md` | not edited; the "after" numbers go in `tasks/TASK_REVIEW_T041.md` |
| Pre-existing pin tests | `test/docs-tools.test.ts` (tool names in README + RUNBOOK, "all 26 tools"): unchanged, keep green. `test/stdio.test.ts` (handshake returns 26 tools): unchanged. Any test matching description text: find with grep before editing, repoint. |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/*.ts`, `src/reports/index.ts`, `src/api/run-test.ts`, `src/stdio.ts` | no behaviour change in this task |
| Handler bodies in `src/server.ts` | descriptions only |
| `.claude/`, `skills/`, `agents/`, `scripts/` | harness |

---

## Test Plan

1. Budget test red on the starting commit, green at the end.
2. Schema-unchanged check: dump `{name, properties: {arg: {type, enum, minimum, maximum}}, required}` before and after; diff is empty.
3. Full `npm test`; `tsc --noEmit`.
4. qa-expert checks the 17 facts against the new `tools/list` output.
5. Supervisor reruns the baseline flows in "after" mode.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T041.md`'s Evidence table
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in the running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
