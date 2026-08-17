# TASK_GUIDE — T013: Truthful Verdicts — `ui_check`, `ui_wait_for`, Screenshot Budget
**Date**: 2026-08-17
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`
**Source**: `BRAINSTORMING_LOG_reports.md` — Option B, slice B1 (approved 2026-08-17)

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Apply the C2 process from the Complexity matrix in `.claude/agents/general-agent-template.md`
6. Read `BRAINSTORMING_LOG_reports.md` — it carries the evidence and the rejected alternatives; do not re-litigate the direction
7. Multi-file task — review `src/server.ts` (especially `recordAction`, lines ~98-112), `src/tools/session.ts`, `src/tools/web.ts`

---

## Requirement (Pillar 1 — Adapt the requirement)

A session is currently marked `failed` by `recordAction` on **any** action returning `ok: false`, and `ui_assert` returns `ok: false` when its condition merely evaluates falsy (`server.ts:262`). There is no way for a caller to check a condition without condemning the entire run. Agents therefore poll with `ui_assert` while waiting for the page to render, and a single not-yet-true check permanently reddens a session whose functional steps all passed.

**Restated intent**:
> Give callers a way to *look* at the page without *judging* the run, and a way to *wait* for it — so that a report marked `failed` means the application misbehaved, not that the agent asked early. Reduce the artifact bloat that the current fail-on-everything behaviour produces.

**Evidence this is real** (from `orderly/smoke-reports/`, 7 recorded sessions):
- `session-d39f9fa4` — status `failed`. Asserted a tab existed, got false (Angular had not painted), asserted again, got true, then completed a correct toggle → persist → revert cycle. Every functional step passed.
- `session-fadfee87` — status `failed`. Four consecutive false assertions on one header condition, same polling cause.
- Five of seven reports are **284-357 KB** for ~30 actions, because `recordAction` captures an auto-screenshot on every failure including these soft ones.

**Out of scope** (belongs to T014):
- `ui_step` intent labels and the grouped renderer
- Per-action duration rendering
- Console + network error capture
- Any change to the HTML layout beyond what is needed to display soft checks at all

**Explicitly ruled out by the approved direction**:
- Changing `ui_assert`'s semantics. It keeps its hard-fail meaning. The fix is **additive only** — confirmed by the user on 2026-08-17. Reinterpreting `ui_assert` would silently change what every existing report means.

**Requirement Refs** — these describe behaviour `PRD.md` does not yet cover. **Add them to `PRD.md` as part of this task** (Functional Requirements table, `US-005`), then check the fidelity gate:

- **FR-014**: The system must provide a `ui_check(condition)` tool that evaluates a condition and records the outcome **without** marking the session failed.
- **FR-015**: The system must provide a `ui_wait_for(condition, timeoutMs)` tool that polls a condition until it holds or the timeout elapses; a timeout **is** a hard failure.
- **NFR-008**: A session report must remain small enough to open and read in a browser; duplicate screenshots must not be embedded more than once.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match `BRAINSTORMING_LOG_reports.md` — Option B / B1
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (session, action, soft check)
- [ ] Every Acceptance Criterion below traces to a Requirement Ref
- [ ] FR-014, FR-015, NFR-008 have been **added to `PRD.md`** and are fully covered by the Acceptance Criteria

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_check(condition)` evaluates the condition against the current page and reports pass/fail to the caller | FR-014 |
| 2 | A `ui_check` whose condition evaluates falsy leaves session status `passed`, captures **no** auto-screenshot, and is still recorded in the report as a soft check | FR-014, NFR-008 |
| 3 | A `ui_check` that cannot *run* (no active page, condition throws) is a **hard** failure — same as today's `ui_assert` harness errors | FR-014 |
| 4 | `ui_assert` behaviour is byte-for-byte unchanged: falsy condition still marks the session failed and still captures a screenshot | (regression guard — additive-only ruling) |
| 5 | `ui_wait_for(condition, timeoutMs)` returns as soon as the condition holds, recording one action; the intermediate polls are **not** recorded individually | FR-015 |
| 6 | `ui_wait_for` that never satisfies within `timeoutMs` marks the session failed and captures a screenshot | FR-015 |
| 7 | Identical screenshots are embedded in the HTML report only once, referenced thereafter | NFR-008 |
| 8 | Auto-failure screenshots are capped per session (budget configurable, default documented); when the cap is hit the report says so rather than silently omitting | NFR-008 |
| 9 | `ui_assert`'s tool description steers callers to `ui_wait_for`/`ui_check` for readiness polling | (adoption mitigation from brainstorm) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session → `ui_check("false")` → `ui_end_session` | Report status `passed`; the soft check appears in the report marked as a non-fatal check; `failureScreenshot` is unset | automated test |
| 2 | Session → `ui_assert("false")` → `ui_end_session` | Report status `failed` with a failure screenshot — unchanged from today | automated test (regression) |
| 3 | Session → `ui_check` before any `ui_navigate` | Hard failure ("No active page"), status `failed` | automated test |
| 4 | Session → `ui_check("throw new Error('x')")` | Hard failure (the expression could not run), status `failed` | automated test |
| 5 | Page where a condition becomes true after ~300ms → `ui_wait_for(cond, 5000)` | Returns ok; exactly **one** action recorded; status `passed` | automated test |
| 6 | Condition that is never true → `ui_wait_for(cond, 500)` | Hard failure after ~500ms, status `failed`, screenshot captured | automated test |
| 7 | Session producing 20 identical failure screenshots | HTML contains the image data once, not 20 times; file size well under the pre-change baseline | automated test asserting output size / occurrence count |

### Verification Command (exact, runnable)

```bash
npm test -- session
```

Plus a live drive against the container (the T003 precedent): start a session, run one `ui_check("false")` and one `ui_assert("true")`, end it, and confirm on the host that the emitted report reads `passed`.

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ✅ pass | `test/session.test.ts` — 14 new tests covering all 7 Success Criteria plus 2 regression guards. 19/19 pass in that file (5 pre-existing + 14 new). |
| Verification command run | ✅ pass | `node --import tsx --test test/session.test.ts` → 19/19 pass, 0 fail. |
| Negative cases hold | ✅ pass | Harness errors stay hard (no page / expression throws → fatal even for `ui_check`); `ui_wait_for` timeout is fatal; non-positive `timeoutMs` rejected without spinning; unknown-session `claimFailureScreenshot` returns false; missing screenshot file omitted rather than crashing the report. |
| verify | ✅ pass | Live MCP drive against the rebuilt container (`docker compose up -d --build`). Soft-check session: `ui_navigate` → `ui_check` false → `ui_wait_for` (held after 407ms) → `ui_assert` true → **ended (passed)**, `failureScreenshot: None`, HTML reads "4 actions, 0 failed, 1 non-fatal check(s) evaluated false", 4.0K. Hard session: `ui_assert false` + `ui_wait_for` timeout → **ended (failed)**, `failureScreenshotCount: 2`, 12K, image embedded once. `tools/list` returns 10 tools including `ui_check` + `ui_wait_for`. |
| Review scope bounded to the change's blast radius | ✅ pass | Reviewed only T013's changed files: `src/tools/session.ts`, `src/tools/web.ts`, `src/server.ts`, `src/reports/index.ts`, `test/session.test.ts`. |
| Full smoke suite still green (no regression) | ⚠️ pre-existing failures only | `test/session.test.ts` 19/19, `test/web.test.ts` 16/16, `test/health.test.ts` 2/2. `test/api-run-test.test.ts` 2/4 — **both failures reproduce identically on a clean tree** (verified by `git stash push -- src test`, re-running, then `git stash pop`). Cause is environmental: those two tests spawn a second server on port 8765, which the running Docker container already owns (`network_mode: host`) — the collision documented in `memory/learnings.md`. Not caused by this task. |
| **Regression: `ui_assert` semantics unchanged** | ✅ pass | AC4. Two guards written before the implementation: `isFatalOutcome` returns true for a hard falsy assert, and a hard-failure session still ends `failed` with the failure recorded. Confirmed live: `ui_assert false` → session `failed`. |
| **UI: Visual regression** | ☐ N/A | No UI — backend/tooling task |
| **UI: Design-system compliance** | ☐ N/A | No UI — backend/tooling task |
| **UI: Responsiveness** | ☐ N/A | No UI — backend/tooling task |

---

## Approach

`assertCondition` in `src/tools/web.ts` **already** returns `ok` (could it run) and `passed` (did it hold) as separate fields. The defect is entirely in how `server.ts:262` collapses them into a single boolean for `recordAction`. That is the shape of the fix: stop collapsing, and let the recording layer know whether a falsy result is fatal.

Suggested mechanics, not binding:

1. Add `soft?: boolean` to `LoggedAction` in `src/tools/session.ts`.
2. Give `recordAction` a way to record a non-fatal outcome — an extra parameter or an options object — that skips both `markFailed` and the auto-screenshot.
3. Register `ui_check` reusing `assertCondition` unchanged; pass `soft: true` when the condition ran but evaluated falsy. A `ok: false` (harness error) stays hard.
4. Register `ui_wait_for` as a poll loop around `assertCondition` with a sane interval (~100ms). Record **one** action for the whole wait — the intermediate polls are the noise this task exists to remove.
5. Screenshot dedupe: hash the file contents in `src/reports/index.ts` and emit each distinct image once, referencing subsequent occurrences. Budget: cap auto-failure captures per session, and record that the cap was reached.
6. Rewrite `ui_assert`'s description to steer: a failure there fails the whole session; use `ui_wait_for` to wait and `ui_check` for non-fatal checks.

**Reuse over invention**: `takeScreenshot`, `assertCondition`, and `atomicWrite` all exist and are correct. This task should add no new abstraction beyond the `soft` flag and the poll loop.

---

## Edge Case Checklist

- [ ] Soft check that fails and nothing else does → status `passed`, **and the soft failure is still visible in the report** (silently swallowing it is the opposite failure mode and just as bad)
- [ ] Hard `ui_assert` failure still marks `failed` and still captures the failure screenshot — the safety property must survive
- [ ] `ui_check` with no active page → hard, not soft (a harness error is not a soft check)
- [ ] Condition that throws (`ReferenceError`) vs one that evaluates falsy — `assertCondition` already distinguishes these; the distinction must survive into the report
- [ ] `ui_wait_for` with `timeoutMs` longer than `SESSION_TIMEOUT_MS` → the session cleanup must still win; do not let a wait outlive its session
- [ ] `ui_wait_for` where the condition throws on the first poll but would later succeed — decide and document: throw-is-hard-immediately, or keep polling. Recommend hard-immediately (a `ReferenceError` will not fix itself)
- [ ] `ui_wait_for` with `timeoutMs: 0` or negative → clamp or reject; do not spin
- [ ] Screenshot dedupe when the file is missing/unreadable — existing `toBase64Image` swallows it; keep that behaviour
- [ ] Screenshot budget reached mid-session → report states the cap was hit rather than silently dropping captures (a silent cap is the same class of bug this task fixes)
- [ ] `run-test.ts` sessions (no checks, no waits) produce byte-comparable reports to before, modulo dedupe
- [ ] Concurrent sessions — soft state must be per-session, not module-global

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/session.ts` | `soft?: boolean` on `LoggedAction`; no change to `markFailed`'s contract |
| `src/server.ts` | Register `ui_check` + `ui_wait_for`; teach `recordAction` about non-fatal outcomes; rewrite `ui_assert`'s description text |
| `src/tools/web.ts` | Add the `ui_wait_for` poll loop next to `assertCondition`; `assertCondition` itself unchanged |
| `src/reports/index.ts` | Screenshot hash-dedupe; render soft checks distinguishably from hard assertions |
| `test/session.test.ts` | New tests for all 7 Success Criteria, including the `ui_assert` regression guard |
| `PRD.md` | Add FR-014, FR-015, NFR-008 |
| `README.md` | Document the two new tools and when to use each |
| `PROJECT_KANBAN.md` | Task status |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/api/run-test.ts` | A separate consumer of `writeReports`; this change must be transparent to it. If it needs editing, the design is wrong — stop and report |
| `Dockerfile`, `docker-compose.yml` | No infrastructure change is needed for this task |
| `.claude/`, `templates/`, `memory/` | Supervisor framework scaffolding |
| Anything under the Android milestone (T007-T012 surface) | Parallel work in flight; do not refactor `session.ts` beyond adding the field |

---

## Test Plan

Automated (`test/session.test.ts`): the 7 Success Criteria above, with AC4 (`ui_assert` unchanged) written **first** so the regression guard exists before the new behaviour lands. Manual: drive a live session through the container and confirm the emitted report reads `passed` for a soft-check-only failure.

**Note on test placement** — keep new test files flat under `test/`, not in subdirectories: `npm test`'s glob runs under `/bin/sh`, which lacks zsh's `**` globstar and silently drops nested files (recorded in `memory/MEMORY.md` from T003).

---

## Deviations from the predicted approach

1. **`isFatalOutcome(entry)` extracted into `session.ts`** rather than the fatal/soft decision living inline in `server.ts`. `recordAction` is defined inside the per-connection `buildMcpServer()` closure and is not exported, so the semantics would otherwise have been untestable except through a live MCP drive. The predicate is pure and is now the thing the regression guard actually asserts against.

2. **`claimFailureScreenshot(id, budget)` owns the budget**, with `failureScreenshotCount` + `screenshotBudgetReached` on `SessionRecord`. This keeps the counter per-session (not module-global, which would have leaked across concurrent sessions) and lets the renderer state that captures were dropped.

3. **Screenshot dedupe is done with CSS classes, not repeated `<img src="data:...">`.** A data URI cannot be referenced twice without repeating its bytes, so each distinct image is emitted once as a `background-image` rule keyed by a content hash, and rows reference it by class. `toBase64Image` became dead and was removed.

4. **`MAX_WAIT_MS = 60_000` clamp added to `waitForCondition`**, enforced both in the function and in the zod schema. The Edge Case Checklist requires that a wait cannot outlive its session; a hard ceiling well under `SESSION_TIMEOUT_MS` (10 min) is the simplest way to guarantee it.

5. **Honest correction to the brainstorm's sizing claim.** `BRAINSTORMING_LOG_reports.md` said the 284-357 KB reports were bloated by "near-identical failure captures". They are not: the real reports embed **1-2 images** (`grep -c 'data:image/png;base64'`), and the size is one large full-screen PNG inflated ~33% by base64. Consequences:
   - **AC7 (dedupe) is correct but lower-value than assumed.** It cannot fire on failure screenshots at all, because `SessionRecord.failureScreenshot` only ever holds one path. It fires when the same screen is captured twice (verified in test and in the live hard-fail drive).
   - **AC8 (budget) mostly saves disk churn, not report size** — the record retains only the latest failure screenshot regardless.
   - **The real size win is AC2**: a polling session that previously auto-captured a full-screen PNG on its first soft failure now captures nothing. The live soft-check report is **4.0 KB**; the equivalent old-behaviour reports in `orderly/smoke-reports/` are 144-357 KB.

   Both ACs are implemented as specified. This note exists so the next reader does not inherit the wrong mechanism.

---

## Cross-Repo Follow-Up (do not skip)

`orderly/.claude/docs/ui-smoke-testing-with-claude.md` documents an anti-polling workaround for precisely the bug this task fixes. Once T013 lands, that section must be rewritten to teach `ui_wait_for` / `ui_check` instead. **Adoption is the named failure mode for this whole direction** — new tools that nobody calls change nothing. Flag this to the Supervisor when reporting the task ready; the doc lives in a different repo and cannot be edited from this one's worktree.

---

## Completion Checklist

- [x] FR-014, FR-015, NFR-008 added to `PRD.md`
- [x] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run — deferred to Stage 4 (Supervisor-run)
- [x] Lint passes (`npm run build` / `tsc -p tsconfig.json` — 0 errors)
- [x] Tests written AND pass — 19/19 in `test/session.test.ts`, output in Evidence table
- [x] `ui_assert` regression guard green (AC4) — unit + live
- [x] `Skill({ skill: "verify" })` run — live container drive, both soft and hard paths
- [x] `README.md` updated — new tools + "Verifying vs waiting" guidance
- [ ] `memory/MEMORY.md` updated — Supervisor-only write; flagging: (a) soft-vs-hard outcome split is now the core session semantic, (b) the 284-357 KB report size was **one large PNG**, not duplicate captures — the brainstorm's stated mechanism was wrong, (c) `npm ci` was needed locally; this repo normally only builds inside Docker
- [ ] Cross-repo follow-up flagged to Supervisor — `orderly/.claude/docs/ui-smoke-testing-with-claude.md` still teaches the anti-polling workaround
- [x] Supervisor notified: task ready for Stage 4 review
