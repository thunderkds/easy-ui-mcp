# TASK_GUIDE — T014: Human-Readable Reports — `ui_step`, Grouped Renderer, Durations, Console/Network Capture
**Date**: 2026-08-17
**Complexity Level**: C2
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`
**Source**: `BRAINSTORMING_LOG_reports.md` — Option B, slice B2 (approved 2026-08-17)
**Blocked by**: T013
**Gate**: Do not start until a human has reviewed a report produced by T013 and confirmed B2 is still wanted. The brainstorm explicitly left open the possibility that URL-derived sections read well enough on their own.

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Apply the C2 process from the Complexity matrix in `.claude/agents/general-agent-template.md`
6. Read `BRAINSTORMING_LOG_reports.md` and `tasks/TASK_GUIDE_T013.md` — this task builds directly on T013's `soft` flag
7. Open one of the reports in `orderly/smoke-reports/*.html` in a browser. **Look at what you are replacing before you replace it.**

---

## Requirement (Pillar 1 — Adapt the requirement)

The HTML report is a machine transcript rendered as HTML: `renderHtml` (`src/reports/index.ts`, 108 lines total) emits one flat table row per primitive call with columns `Time | Action | Result | Detail | Screenshot`. A row reads `ui_click | OK | [data-cy=boss-table-row]:nth-child(2) [data-cy=boss-table-column-4] sl-switch`. Nothing states *what was being verified*. The only human-authored string in the entire artifact is `target`.

`PRD.md` names persona P2 as a "Solo Developer / QA Engineer" who "wants ... a clear report". The current artifact does not serve that persona, and it cannot be made to by styling alone: the server records what was *done*, never what it was *for*.

**Restated intent**:
> Let the caller state intent, then render the session as what a human actually wants — a verdict, a short sequence of named steps with outcomes, the evidence, and the raw log available but out of the way. Add the two pieces of information the report should always have had: how long each step took, and whether the page was throwing errors while we declared success.

**Out of scope**:
- Any change to session pass/fail semantics — T013 owns that, and it is settled
- Video/trace capture — breaks the self-contained-single-file property (see brainstorm, adjacent item 7)
- A reports index page and stable filename slugs — real ideas, deliberately not in this task
- Server-side LLM calls to generate prose. **Hard constraint** (`PROJECT_SPEC.md`): every human-readable string is either caller-supplied or deterministically derived

**Requirement Refs** — add to `PRD.md` (Functional Requirements, `US-005`) as part of this task:

- **FR-016**: The system must provide a `ui_step(label)` tool that attaches a caller-supplied intent label to all subsequent actions until the next `ui_step`.
- **FR-017**: The HTML report must present a session as a verdict summary plus labelled steps with per-step outcomes; the raw action log must remain available but must not be the primary view.
- **FR-018**: The system must capture browser console errors and failed network requests during a session and surface them in the report.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match `BRAINSTORMING_LOG_reports.md` — Option B / B2
- [ ] The B2 go/no-go gate above has been cleared by a human
- [ ] Every Acceptance Criterion below traces to a Requirement Ref
- [ ] FR-016, FR-017, FR-018 added to `PRD.md`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_step(label)` records a step marker; every subsequent action is attributed to that label until the next `ui_step` | FR-016 |
| 2 | A session with **no** `ui_step` calls still renders correctly under a single implicit group | FR-016 |
| 3 | The report opens with a verdict summary: status, target, wall-clock duration, and step/check counts | FR-017 |
| 4 | Each step renders with its label, its outcome, and its elapsed time | FR-017 |
| 5 | Actions with no caller label render a deterministically derived description (e.g. `ui_fill` on `[data-cy='password'] input` → "Filled `[data-cy='password'] input`"), never a raw JSON dump | FR-017 |
| 6 | Soft checks (T013) render visibly but distinguishably from hard assertions — present, not hidden, not alarming | FR-017 |
| 7 | The raw action table is still in the document, collapsed behind a disclosure element | FR-017 |
| 8 | Console errors and failed network requests during the session are captured and listed in the report | FR-018 |
| 9 | Console/network errors do **not** change session status — surface only | FR-018 (see Open Decision) |
| 10 | The report remains a single self-contained file that opens offline with no external requests | (existing property — regression guard) |
| 11 | A 100+ action session renders and opens in a browser without hanging | (edge case) |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session with 3 `ui_step` calls and actions under each | HTML contains 3 labelled step groups in order, each with its actions | automated test |
| 2 | Session with zero `ui_step` calls (e.g. any existing prompt, or `run-test.ts`) | Renders under one implicit group; no crash, no empty headings | automated test |
| 3 | Session with 2 passing steps and 1 failing | Summary reads the failure count; the failing step is visually identifiable | automated test |
| 4 | Step label containing `<script>alert(1)</script>` | Escaped in output; no executable markup | automated test (security) |
| 5 | Page that logs a console error but whose assertions all pass | Status `passed`, console error listed in the report | automated test |
| 6 | Page with a failing XHR | The failed request appears with its URL and status | automated test |
| 7 | Generated report opened with network disabled | Renders fully — no external CSS/JS/font/image requests | manual + grep for `http://` / `https://` in output |
| 8 | 120-action session | Report generated; file opens; size sane | automated test |

### Verification Command (exact, runnable)

```bash
npm test -- session reports
```

Then regenerate one of the `orderly/smoke-reports/` flows against the new build and put the before/after HTML side by side for the user. **That comparison is the actual acceptance test for this task** — "readable by an end user" is a human judgement, and the brainstorm flagged it as such.

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ | |
| Verification command run | ☐ | |
| Negative cases hold | ☐ | |
| verify | ☐ | |
| Review scope bounded to the change's blast radius | ☐ | |
| Full smoke suite still green (no regression) | ☐ | |
| **Before/after report pair produced and reviewed by the user** | ☐ | The real acceptance gate |
| **Self-contained: no external requests** | ☐ | AC10 |
| **UI: Visual regression** | ☐ | The report *is* the UI here — compare against the before artifact |
| **UI: Design-system compliance** | ☐ N/A | No design system in this project; `templates/report_template.html` is the nearest reference if a house style is wanted |
| **UI: Responsiveness** | ☐ | Report should be readable at laptop width; it gets attached to PRs and read in-browser |

---

## Approach

Two independent pieces that happen to ship together; build them in this order so the risky one is not blocking the cheap one.

**1. Step attribution (small).** Add `currentStep?: string` to the session and `step?: string` to `LoggedAction`. `ui_step(label)` sets it. `recordAction` stamps it. Grouping in the renderer is then a `reduce`. Note the ordering property to preserve: actions before the first `ui_step` belong to the implicit group, not to the first labelled one.

**2. The renderer (the actual work).** `renderHtml` gets restructured, not patched:
- a verdict header (status, target, duration, counts)
- steps as sections, each with label, outcome, elapsed time, and its actions as readable lines
- a `describe(action)` formatter — a pure function from `LoggedAction` to a sentence, deterministic, easily unit-tested, and the single place any phrasing lives
- evidence (screenshots) shown per step rather than per row
- the existing raw table preserved verbatim inside a `<details>`

**3. Console/network capture.** Playwright's `page.on('console')` and `page.on('requestfailed')`, wired at session start in `src/tools/session.ts` where the page is created. Store on the session record; render as a distinct section. Keep the handler cheap and cap what is retained — an app in a redirect loop can emit thousands of console lines, and this must not become a new source of 300 KB reports right after T013 fixed the old one.

**Reuse**: `escapeHtml`, `toBase64Image`, `atomicWrite` all exist and are correct. `describe()` is the only genuinely new abstraction this task should introduce.

---

## Open Decision (resolve at planning, do not guess in code)

**Should a console error affect session status?** The working assumption is **no — surface only, never fail the run** (AC9), consistent with T013's additive-only ruling and with not re-creating the false-FAILED problem in a new form. But a flow that "passes" while the console throws is exactly the false green FR-018 exists to catch, so there is a real argument for a third status (`passed with warnings`).

Take this to the Supervisor before implementing. Do not invent a third status value unilaterally — `SessionStatus` is consumed by `run-test.ts` and by every existing report.

---

## Edge Case Checklist

- [ ] Session with zero `ui_step` calls — the common case today; must render cleanly
- [ ] Actions recorded **before** the first `ui_step` — implicit group, not silently attached to the first label
- [ ] Two consecutive `ui_step` calls with no actions between — empty step renders, or is omitted; pick one and be consistent
- [ ] `ui_step` label containing HTML or quotes — must route through `escapeHtml` like every other caller string
- [ ] `ui_step` called with an empty/whitespace label — reject or fall back; do not emit a blank heading
- [ ] Very long session (100+ actions) — report must stay open-able
- [ ] Console handler on a page that emits thousands of lines — cap retention, note the cap in the report
- [ ] Console errors emitted *after* the last action but before `ui_end_session` — captured or explicitly dropped, not a race
- [ ] Page closed / navigated away while a console listener is attached — must not throw during teardown
- [ ] `run-test.ts` reports (no steps, no checks) render unchanged in substance
- [ ] Duration when `endedAt` is missing (timed-out session) — render "unknown", not `NaN`
- [ ] Timestamps are ISO strings; duration maths must not assume same-day or local time
- [ ] Report must remain self-contained — no CDN CSS, no web fonts, no external images (AC10)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/session.ts` | `step?: string` on `LoggedAction`; `currentStep` on session; console/network listeners attached at page creation; retained-errors array on the record |
| `src/server.ts` | Register `ui_step`; `recordAction` stamps the current step |
| `src/reports/index.ts` | Renderer restructure: verdict header, grouped steps, `describe()` formatter, per-step evidence, collapsed raw table, console/network section |
| `test/session.test.ts` | Step attribution, implicit group, escaping, console/network capture |
| `test/reports.test.ts` | New — `describe()` unit tests and rendering assertions (pure function, no browser needed) |
| `PRD.md` | Add FR-016, FR-017, FR-018 |
| `README.md` | Document `ui_step` and the report's new shape |
| `PROJECT_KANBAN.md` | Task status |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/api/run-test.ts` | Separate consumer of `writeReports`; the change must be transparent to it |
| `src/tools/web.ts` | The primitives are correct and transport-agnostic; this task is recording + rendering only |
| T013's soft-check semantics | Settled; if this task wants to change them, the design is wrong — stop and report |
| `Dockerfile`, `docker-compose.yml` | No infrastructure change needed |
| `.claude/`, `templates/`, `memory/` | Supervisor framework scaffolding |
| Existing files in `orderly/smoke-reports/` | Historical evidence, not regenerable — produce new artifacts for comparison, never overwrite these |

---

## Test Plan

Automated: split rendering tests into `test/reports.test.ts`, since `describe()` and the grouping reduce are pure functions testable without a browser — cheap, fast, and the highest-value unit tests in this task. Browser-dependent tests (console/network capture) stay in `test/session.test.ts`.

Manual and decisive: regenerate a real orderly flow and diff the artifact against its predecessor for a human to judge.

**Note on test placement** — keep new test files flat under `test/` (see T013; `npm test`'s glob runs under `/bin/sh` with no globstar).

---

## Cross-Repo Follow-Up

`orderly/.claude/docs/ui-smoke-testing-with-claude.md` should gain a short "what a good report looks like" section once this lands, and its prompt template should instruct the agent to call `ui_step` with intent labels. Without that, `ui_step` gets no callers and this task delivers an implicit-single-group renderer — which is the 50% version the brainstorm costed at half the code. Flag to the Supervisor when reporting ready.

---

## Completion Checklist

- [ ] B2 go/no-go gate cleared by a human (after reviewing T013 output)
- [ ] Open Decision (console errors vs status) resolved with the Supervisor
- [ ] FR-016, FR-017, FR-018 added to `PRD.md`
- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (`tsc -p tsconfig.json` — 0 errors)
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] Before/after report pair produced for user review
- [ ] `Skill({ skill: "verify" })` run — live container drive
- [ ] `memory/MEMORY.md` updated (Supervisor-only write — flag findings rather than editing)
- [ ] Cross-repo follow-up flagged to Supervisor
- [ ] Supervisor notified: task ready for Stage 4 review
