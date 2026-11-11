# TASK_GUIDE — T040: Compact page state with refs (low-token default for `ui_get_page_state`)
**Date**: 2026-11-11
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: backend-developer (implement, test-first), qa-expert (independent verify)
**Agent guide**: `agents/backend.md`

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `BRAINSTORMING_LOG_low-token.md`, `docs/experiments/token-baseline-2026-11-11.md` and this guide.)

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `BRAINSTORMING_LOG_low-token.md` (Option A is the approved path) and `docs/experiments/token-baseline-2026-11-11.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

User, 2026-11-11: apply agent-browser's low-token principles to easy-ui-mcp — a compact interactive snapshot with short stable refs (`@e1`, `@e2`, …) as the default, the current rich format on request, and refs accepted alongside the current verified selectors — while keeping sessions, step labels, assert/check/wait and the HTML/JSON reports. After the baseline experiment the user approved: compact by default with `format: "full"` in the same task; refs invalidated by every new snapshot; viewport scoping later.

**Restated intent**:
> `ui_get_page_state` replies with one short line per element carrying a ref instead of a selector, and every tool that takes a selector also takes that ref. A ref never acts on a different element than the one listed: if the page changed, the call fails and tells the agent to take a new snapshot. Reports and the action log keep showing real selectors.

**Out of scope**:
- Viewport-only or `within` scoping of the snapshot (follow-up)
- Trimming tool descriptions beyond the lines this task must edit (T041)
- Changing action replies to `{"ok":true}`; grouping tools
- The empty snapshot straight after a navigating click (separate bug)
- Any change to how selectors are built or how actions run

**Requirement Refs**:
- FR-004: `ui_get_page_state` returns the page's state for the agent to choose its next step
- FR-022: element state, overlays and focus stay in the reply
- FR-002: primitive action tools keep accepting selectors
- FR-005 / FR-017: reports stay readable (real selectors, not refs)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor; user approved the three decisions 2026-11-11)
- [x] Domain terms align with `PROJECT_SPEC.md` ("page state", "selector", "session"); new term: **ref**
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
| 1 | `ui_get_page_state` with no arguments replies in the compact text format below: `url:` and `title:` lines, then one line per element `@eN role "name"` followed by its non-default state; `overlay @oN role "name" [modal]` lines; `focused:`; `messages:`; `note:` when capped. No selector appears in the compact reply. | compact default |
| 2 | `ui_get_page_state` with `format: "full"` replies with exactly the JSON the tool returns today for the same page (same keys, same selectors, no ref field). | rich format on request |
| 3 | Every tool argument that takes a selector (`selector`, and `from` / `to` of `ui_drag`, `container` of `ui_scroll`) accepts `@eN` / `@oN` from the latest snapshot of that page and acts on exactly that element. CSS and Playwright selectors behave as before. | refs alongside selectors |
| 4 | A ref whose element is gone, replaced or no longer the single match of its selector fails with an error that names the ref and says to call `ui_get_page_state` again. Nothing is clicked or typed. The same holds for a ref used before any snapshot and for an unknown number. | never the wrong element |
| 5 | Refs are per page: a ref from one session or tab does not resolve in another. | multi-session kept |
| 6 | The action log and the JSON/HTML report of a session that used refs show the resolved selector for each action, and no bare `@eN`. | reports stay readable |
| 7 | State rules are unchanged in both formats: only non-default fields, `value` cut at 100 characters, names at 80, a password value never printed, at most 200 elements with the existing note. | FR-022 kept |
| 8 | On the baseline flows the tool traffic is at or below the experiment's "compact + refs" figures within 10%: TodoMVC ≤ 910, Saucedemo ≤ 1,330, Wikipedia ≤ 5,400, Hacker News ≤ 6,050 tokens (chars ÷ 4), with the flows passing using refs. | the token saving |
| 9 | `README.md`, `RUNBOOK.md`, `site/index.html` and `PROJECT_SPEC.md` describe the compact default, refs, the stale-ref rule and `format: "full"`; the tool description of `ui_get_page_state` and the selector argument descriptions say refs are accepted. | docs match behaviour |
| 10 | `npx tsc --noEmit -p tsconfig.json` is clean and the full `npm test` passes, with new tests for criteria 1–7. | no regression |

Compact reply shape (normative):
```
url: https://www.saucedemo.com/inventory.html
title: Swag Labs
@e1 button "Open Menu"
@e2 combobox "Name (A to Z)" value="az"
@e3 checkbox "Remember me" checked required
@e4 button "Add to cart" disabled
overlay @o1 dialog "Confirm" modal
focused: @e2
messages: "Saved" | "2 items"
note: Showing first 200 of 512 elements; use a CSS selector for the rest
```
State prints as ` key` for `true` and ` key=value` otherwise (strings JSON-quoted). Names are JSON-quoted so a quote or newline cannot break a line. `focused:` prints the ref when the focused element is in the list, otherwise `role "name"`. Lines with nothing to show are omitted. The tool description gains one short sentence explaining the format and the stale-ref rule.

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given | Expect | How it's checked |
|---|-------|--------|------------------|
| 1 | A page with a named button, a filled text input, a checked required checkbox, a password field with a value | Compact reply has one `@eN` line each, `value=` on the text input only, ` checked required` on the checkbox, no selector text | automated test |
| 2 | Same page, `format: "full"` | Reply parses as JSON and deep-equals `getPageState()`'s struct | automated test |
| 3 | Snapshot, then `ui_click` with `@eN` of a button | The button's click handler ran; reply and action log name the resolved selector | automated test |
| 4 | Snapshot, then the list is re-ordered or the element replaced by a look-alike node, then `ui_click @eN` | Error naming the ref and `ui_get_page_state`; no click handler ran on any element | automated test |
| 5 | Two sessions, snapshot in A only, `ui_click @e1` in B | Error (no snapshot for that page); nothing clicked in B | automated test |
| 6 | `ui_drag` with two refs; `ui_scroll` with a `container` ref; `ui_click_outside` with `@o1` | Each acts on the listed element | automated test |
| 7 | `@e999`, `@e0`, a ref before any snapshot | Clear error, nothing acted on | automated test |
| 8 | A session using refs is ended | Report JSON actions carry selectors; the string `@e` does not appear as an action target | automated test |
| 9 | The four baseline flows driven with refs against the built change | Traffic within AC 8 limits | Supervisor/QA rerun of the experiment script in "after" mode |

### Verification Command (exact, runnable)

```bash
npx tsc --noEmit -p tsconfig.json && node --import tsx --test test/web.test.ts && npm test
```
`npm test` needs port 8765 free (`ss -ltnp | grep 8765` prints nothing). Criterion 8 is measured by the Supervisor/QA after implementation, not by the implementing agent.

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer in `tasks/TASK_REVIEW_T040.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T040.md`. BEFORE is the baseline in `docs/experiments/token-baseline-2026-11-11.md` (traffic now: TodoMVC 1,413 · Saucedemo 2,092 · Wikipedia 26,192 · Hacker News 27,086 tokens).

---

## Approach

**Pattern reference**: `src/server.ts` `registerSessionTool` / `guardDialog` — one wrapper every session-aware tool passes through; and `src/tools/web.ts` `buildSelector` / `locate` — verification by element identity.

**Vital slice**: the compact renderer plus ref resolution for `selector` in `registerSessionTool` (click and fill cover most use).
**Cut list**: ref echo in action replies (the echo keeps the resolved selector); refs inside `format: "full"`; faster snapshots; viewport scoping; `{"ok":true}` replies.

Option A of the brainstorm, "alias refs with identity check":

1. `web.ts`: `getPageState` keeps returning the same struct. Add `renderCompact(state)` (pure, exported, unit-testable). Add a per-page ref table (`WeakMap<Page, …>`) filled by a snapshot: `ref → { selector, handle }` for elements and overlays. A new snapshot of a page replaces its table and disposes the previous handles. Add `resolveRef(page, ref)` returning the selector, or an error when the ref is unknown or when the selector no longer matches exactly one element that is the stored handle (reuse `locate`).
2. `server.ts`: `ui_get_page_state` gains `format: z.enum(["compact", "full"]).optional()`; compact is the default. In `registerSessionTool`, before the handler runs, replace any string argument under `selector`, `from`, `to`, `container` that matches `^@[eo]\d+$` with the resolved selector, or return the error. Handlers, `recordAction` and the report writer are not changed, so they see a normal selector.
3. Ref table lifetime: the handles `getPageState` already creates must be kept for listed elements instead of disposed (check how they are disposed today and keep that for the rest).
4. No attribute or script is injected into the page under test.

Write the tests first (web.test.ts for the renderer and `resolveRef`; an MCP-level test next to the multi-session tests for per-session isolation and the report).

---

## Edge Case Checklist

- [ ] One documented rule: a ref always means the latest snapshot of that page. After a new snapshot, `@eN` resolves against the new list or fails; it never reaches an element of the old list.
- [ ] A ref used after navigation or after its element is removed/re-rendered fails with a message that says to call `ui_get_page_state` again.
- [ ] A ref used before any snapshot, or an unknown number, fails clearly.
- [ ] Refs are per page: session A's `@e1` never resolves in session B; a new tab has its own table.
- [ ] `ui_drag` with `from` and `to` both refs; `ui_scroll` with `container` as a ref; `ui_press_key` with an optional selector ref.
- [ ] Only the exact pattern `@e<digits>` / `@o<digits>` is treated as a ref; every other string goes to Playwright unchanged.
- [ ] The report and the action log show the resolved selector; no reply prints a typed value it did not print before.
- [ ] Names with quotes or newlines stay on one line and cannot forge an extra `@eN` line.
- [ ] A password value is never printed; `value` cut at 100, names at 80.
- [ ] `format: "full"` deep-equals today's JSON for the same page.
- [ ] Old handles are disposed when a snapshot replaces the table (no handle leak over a long session); a closed page does not throw on the next call.
- [ ] A held native dialog still refuses `ui_get_page_state` and ref actions exactly as before (the T031 guard runs before ref resolution, or the resolution cannot hang on a blocked page).
- [ ] Elements dropped because their selector could not be verified do not shift later refs onto the wrong element (refs are assigned after dropping).
- [ ] No named inner functions in Playwright `evaluate` callbacks (tsx `__name` gotcha).
- [ ] Pin-test pre-flight: the `Pre-existing pin tests` row below is filled before work starts
- [ ] Stale references: grep README, RUNBOOK, `site/`, PROJECT_SPEC, AGENTS.md, HARNESS.md and comments for "`{role, name, selector}`" and "pass `selector` unchanged" and bring them in line

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/web.ts` | `renderCompact`, per-page ref table, `resolveRef` |
| `src/server.ts` | `format` on `ui_get_page_state`; ref resolution in `registerSessionTool`; tool/argument descriptions |
| `test/web.test.ts` | renderer, ref resolution, stale ref, state rules |
| `test/multi-session.test.ts` | per-session ref isolation; report shows selectors |
| `test/dialog-sessions.test.ts` | only if a held-dialog ref case is added |
| `README.md`, `RUNBOOK.md`, `site/index.html`, `PROJECT_SPEC.md` | describe compact default, refs, stale rule, `format: "full"` |
| `test/site.test.ts`, `test/docs-tools.test.ts` | only where a pinned string changes |
| `PRD.md` | FR-004 / FR-022 wording: compact default, full on request |
| Pre-existing pin tests | `test/site.test.ts` pins docs-site strings (`'seeing-the-page': ['ui_get_page_state', 'ui_get_text', 'overlays', 'focused', '4000']`) and forbids raw colours; `test/docs-tools.test.ts` pins tool names and the "all 26 tools" count (unchanged: no tool added); `test/multi-session.test.ts` and `test/dialog-sessions.test.ts` match text inside `ui_get_page_state` replies (`/only-one/` etc. — names still appear in compact form). Handling: keep green; repoint only strings this task changes. |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/session.ts`, `src/reports/index.ts` | recorder and reports already receive resolved selectors |
| `src/api/run-test.ts`, `src/stdio.ts` | unrelated transports |
| `click`, `fill` and the other action functions, `buildSelector` in `src/tools/web.ts` | behaviour must stay identical |
| `docs/experiments/token-baseline.mts` and its results | the measuring stick; the Supervisor adds the "after" mode |
| `.claude/`, `skills/`, `agents/`, `scripts/` | harness |

---

## Test Plan

1. Unit: `renderCompact` on hand-built structs (state printing, quoting, overlays, focus in and out of the list, messages, note, empty page).
2. Browser: `getPageState` + `resolveRef` on `data:` pages — happy path, re-ordered list, replaced node, removed node, navigation, unknown ref.
3. MCP level: compact default and `format: "full"`; click/fill/drag/scroll/click-outside by ref; two sessions; ended session's report JSON has selectors.
4. Full `npm test`; `tsc --noEmit`.
5. Supervisor/QA: rerun the four baseline flows with refs and compare with AC 8.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes (`tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T040.md`'s Evidence table
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in the running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
