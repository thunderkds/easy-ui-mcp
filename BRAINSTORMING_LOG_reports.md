# BRAINSTORMING_LOG_reports.md
**Generated**: 2026-08-17
**Task / Context**: Make session reports readable by end users (QA, PM, PR reviewers) + adjacent enhancements to the UI smoke-test feature
**Skill**: `Skill({ skill: "brainstorming" })`
**Evidence base**: `src/reports/index.ts`, `src/tools/session.ts`, `src/server.ts:98-112`, and the 7 real sessions in `orderly/smoke-reports/`

---

## The Problem Space

The report is currently a **machine transcript rendered as HTML**: a 108-line generator emitting one flat table row per primitive call, with columns `Time | Action | Result | Detail | Screenshot`. That is exactly right for debugging the MCP server and exactly wrong for the humans the PRD names in P2 ("read a clear report").

Three distinct defects, all confirmed against real output rather than inferred:

**1. No narrative.** A row reads `ui_click | OK | [data-cy=boss-table-row]:nth-child(2) [data-cy=boss-table-column-4] sl-switch`. Nothing tells a reader *what was being verified*. The only human-authored string in the entire artifact is `target` ("account access toggle smoke"). A PM cannot answer "did the thing I asked for work?" without reading CSS selectors.

**2. The headline verdict is wrong more often than it is right.** `recordAction` (`server.ts:107-111`) calls `markFailed` on **any** `ok: false`, and `ui_assert` reports `ok: false` when a condition merely evaluates falsy (`server.ts:262`). There is no way to express "check this, don't condemn the run". Agents therefore poll with `ui_assert`, and a single not-yet-rendered check permanently reddens a healthy session. In `orderly/smoke-reports/`, **`session-d39f9fa4` and `session-fadfee87` both read FAILED for flows whose functional steps all passed** - d39f9fa4 asserted a tab existed, got false because Angular had not painted, asserted again, got true, and then completed a correct toggle-persist-revert cycle. This is not a polish issue. A verdict that says FAILED when the feature works is worse for an end user than no report.

**3. The artifact is enormous and mostly noise.** Every failure triggers an auto-screenshot (`server.ts:108-110`), each embedded as base64 in its own table row. Five of seven reports are **284-357 KB for ~30 actions**. The signal - one screenshot showing the toggle in its new state - is buried among near-identical failure captures from the polling loop.

Underlying all three: the tool vocabulary has no concept of **intent**. The server records what was *done*, never what it was *for*. No amount of CSS on the existing data recovers that.

**Non-negotiable constraints**
- No server-side LLM calls (PROJECT_SPEC Critical Constraint). Any prose in the report must be derived deterministically from recorded data or supplied by the caller.
- Reports stay self-contained single files - they get attached to PRs and tickets.
- Existing consumers must not break: `src/api/run-test.ts` writes reports through the same path, and `test/session.test.ts` imports `writeReports` directly.

---

## Questions for the User

1. **Who is the primary reader?** "PM / stakeholder who wants a verdict and a picture" and "QA engineer reproducing a failure" want different documents. This decides whether the raw action log is *demoted to a collapsible section* or *removed from the default view entirely*. My assumption below: primary = reviewer/QA, secondary = PM, so the raw log stays but collapses.
2. **Confirm the repo.** This work lands in `easy-ui-mcp`, not `orderly` - orderly only consumes the output. That repo has its own kanban (T007 currently Ready for Review). Should this become T008+ there, and does it queue behind the Android milestone or jump it?
3. **May `ui_assert` semantics change?** Option B introduces a soft check. Purely additive (new tool, `ui_assert` untouched) is safest but relies on agents choosing the new tool. Changing `ui_assert` to soft-by-default would fix every existing agent prompt at once, but silently reinterprets what a "passed" report means. I recommend additive; confirm.
4. **Is a per-session screenshot budget acceptable?** Capping auto-failure screenshots (e.g. first + last) shrinks reports by ~10x but loses intermediate frames. Fine for readability, occasionally annoying in a hard debug.

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|-------------|-----------------|--------------|
| A | The Presentation Path | Rewrite `renderHtml` only - summary banner, humanised step lines, collapsible raw log, screenshot gallery | Low (1 file) | ~200 lines | Low | |
| B | The Semantic Path | Add `ui_step` (intent labels) + `ui_check` (soft verify), then render steps with verdicts | Medium (4 files) | ~250 lines | Medium | ✅ Yes (staged) |
| C | The Minimalist Path | Summary banner + one derived sentence per row + screenshot dedupe | Very low (1 file) | ~60 lines | Very low | |

### Option A — The Presentation Path

**Approach**: Leave the protocol alone. Rewrite `renderHtml` into a real document: a verdict banner (status, target, duration, "17 of 18 steps passed"), each action rendered as a derived English sentence via a `describe(action)` formatter (`ui_fill` on `[data-cy='password'] input` → "Filled the Password field"), the raw table collapsed behind a `<details>`, and screenshots moved into a gallery with a lightbox instead of one per row.

**Pros**: Single file, zero protocol change, no agent retraining, no risk to `run-test.ts` or existing tests. Immediately better-looking. Ships in one sitting.

**Cons**: Cannot fix defect #2. The banner will confidently render **FAILED** in a nice large font on sessions where the feature works. It also cannot invent intent - `describe()` can say "Clicked a switch in row 2, column 4" but never "Verified Manual Invoice access can be granted", because that information was never captured.

**Why it might fail**: It makes the wrong verdict *more* prominent and more trusted. A polished report carries more authority than an obviously-raw log, so a false FAILED does more damage after this change than before it. Optimising the presentation of bad data is the classic version of this mistake.

### Option B — The Semantic Path (recommended, staged)

**Approach**: Give the protocol a vocabulary for intent, then render it.

- **`ui_step(label)`** - a marker action. Every subsequent recorded action attaches to that step until the next `ui_step`. Implementation is a `currentStep` string on the session and a field on `LoggedAction`; the report groups by it.
- **`ui_check(condition)`** - identical to `ui_assert` but records `soft: true`, so `recordAction` logs it without calling `markFailed` and without burning an auto-screenshot. This is the polling-safe primitive that does not exist today.
- **Renderer** groups actions under their step labels, each step showing a verdict derived from its hard assertions only, with soft checks shown as dimmed sub-lines.

Staged so value lands early:
- **B1 (~70 lines)**: `ui_check` + the `soft` field + skip auto-screenshot on soft failures. Fixes the false-FAILED headline and most of the size problem on its own.
- **B2 (~180 lines)**: `ui_step` + the grouped renderer (which absorbs all of Option A).

**Pros**: Fixes the root cause rather than its rendering. Step labels are exactly the prose the report is missing, and they come free from the agent (which already knows the intent - it just has nowhere to put it). Also improves the *agent's* behaviour: a soft check is the tool it actually wanted when it polled. Purely additive - `ui_assert` keeps its meaning, old reports stay valid, `run-test.ts` untouched.

**Cons**: Two new tools to document and get adopted. Reports become bimodal - a session with no `ui_step` calls must still render sensibly (fallback: one implicit "Session" group).

**Why it might fail**: **Adoption.** New tools do nothing unless agents call them. If a prompt says "run a smoke test" and the model reaches for `ui_assert` out of habit, we have added surface and changed nothing. Mitigations: write the tool descriptions as steering text (`ui_assert`: "a failure here fails the whole session - use ui_check to poll for readiness"), and update `orderly/.claude/docs/ui-smoke-testing-with-claude.md` in the same change so the documented recipe uses them. Adoption is a documentation problem, and it is on us, not the model.

### Option C — The Minimalist Path

**Approach**: Keep the table. Add a verdict banner with counts and duration, add a derived plain-English column, and dedupe screenshots (hash the file, render each once).

**Pros**: An hour's work. Meaningfully better than today. Almost no risk.

**Cons**: Same blindness as A on the verdict, and the result is still recognisably a log with a header bolted on.

**Why it might fail**: "Readable by end users" is a judgement the user makes, not a checkbox. C is likely to come back as "better, but I still can't hand this to a PM" - and then we do B anyway, having spent the budget twice.

---

## 50% Rule Check

For the recommended path, the same business goal with roughly half the code:

**Drop `ui_step` entirely (B2) and keep only `ui_check` (B1), then derive grouping from what is already recorded.** Every `ui_navigate` starts a new visual section, and the section heading is the landed URL. Intent prose comes from a single deterministic `describe(action)` formatter shared with Option A.

That is ~120 lines instead of ~250 and captures most of the value: the verdict becomes truthful, the size collapses, and the report reads as "Logged in → Went to Account Access → 6 checks passed". What is lost is the *why* - "Verified the toggle survives a reload" is a sentence only the caller can write.

**Verdict**: worth building B1 first regardless, since it is the truthful-verdict fix and stands alone. Decide on `ui_step` after seeing B1 rendered - if URL-derived sections read well enough, B2 may genuinely not be needed. That is not a compromise; it is sequencing the cheap correctness fix ahead of the expensive expressiveness one.

---

## Recommended Path

**Option B — The Semantic Path, delivered as B1 then B2, with B2 gated on reviewing B1's output.**

Justification: the user asked for a report an end user can read. The single largest obstacle is not typography, it is that **two of the seven real reports state the wrong outcome**. No presentation work fixes that, and polished presentation of a wrong verdict is actively worse. B1 is small (~70 lines), purely additive, removes the false-FAILED class of bug, and cuts report size by roughly an order of magnitude by not screenshotting soft failures. B2 then buys genuine prose, and by then we will know from B1's output how much is still missing.

---

## Adjacent Enhancements (surfaced, not recommended yet)

Ranked by value-to-effort; each is independently shippable and none belongs in the first task.

| # | Enhancement | Why | Effort |
|---|---|---|---|
| 1 | **`ui_wait_for(condition, timeoutMs)`** | The real primitive missing from the vocabulary. Removes the polling motive at its source instead of making polling harmless. Arguably belongs *in* B1. | S |
| 2 | **Per-action duration** | `endedAt - startedAt` per step turns the report into a rough perf signal; the data is already in the timestamps, only rendering is missing. | XS |
| 3 | **Screenshot budget / dedupe** | Caps 357 KB artifacts. Hash-dedupe is ~15 lines. | XS |
| 4 | **Console + network error capture** | Playwright exposes both. A UI smoke test that passes while the console throws is a false green - this is the highest-value *new information* on the list. | M |
| 5 | **`reports/index.html`** | A dated list of sessions. Today you pick a UUID filename out of a directory. | S |
| 6 | **Trace/video on failure** | Playwright can attach a trace. Definitive for debugging, but breaks the self-contained-single-file property. | M |
| 7 | **Stable report filename / slug** | `session-<slug>-<date>.html` beats a bare UUID when attached to a PR. | XS |

Items 1-3 are small enough to fold into the B1/B2 tasks if the user wants them. Item 4 is the one I would argue for next on merit.

---

## Surgical Scope

Files that **should** be touched (all in `easy-ui-mcp`):
- `src/tools/session.ts` — add `soft?: boolean` (and later `step?: string`) to `LoggedAction`; `currentStep` on the session
- `src/server.ts` — register `ui_check`; teach `recordAction` to skip `markFailed` + auto-screenshot for soft actions; steer `ui_assert`'s description text
- `src/reports/index.ts` — the renderer rewrite (B2 absorbs Option A wholesale)
- `test/session.test.ts` — cover: soft failure leaves status `passed`; hard failure still fails
- `README.md` / `PROJECT_KANBAN.md` — tool docs and task state, per that repo's harness

Files that **must not** be touched:
- `src/api/run-test.ts` — a separate consumer of `writeReports`; the change must be transparent to it
- `src/tools/web.ts` — `assertCondition` already returns `ok`/`passed` separately, which is exactly what soft checks need; the bug is in how `server.ts` collapses them, not here
- Anything in `orderly/` **except** `.claude/docs/ui-smoke-testing-with-claude.md`, which documents the recipe and must be updated in lockstep or adoption fails
- Existing files in `orderly/smoke-reports/` — historical evidence, not regenerable

---

## Edge Case Checklist for TASK_GUIDE

- [ ] Session with **zero** `ui_step` calls still renders (implicit single group) - every existing prompt produces this
- [ ] Session where a soft check fails and **nothing else does** → status must be `passed`, and the report must still surface the soft failure visibly rather than hiding it
- [ ] Hard `ui_assert` failure still marks `failed` and still captures the failure screenshot - the safety property must survive
- [ ] `ui_check` called with no active page (before `ui_navigate`) → that is a *harness* error, not a soft check; must be `ok: false` and hard
- [ ] Condition string that throws (`ReferenceError`) vs one that evaluates falsy - already distinguished in `assertCondition`; the distinction must survive into the report
- [ ] Screenshot file missing/unreadable at render time - existing `toBase64Image` swallows it; keep that behaviour
- [ ] Session that times out (`SESSION_TIMEOUT_MS`) and is cleaned up by `cleanupTimedOutSession` - writes **no** report today; confirm intended or fix separately
- [ ] `ui_step` label containing HTML - must route through `escapeHtml` like every other user string
- [ ] Very long session (100+ actions) - the report must stay open-able in a browser
- [ ] `run-test.ts` reports (no steps, no checks) render unchanged

---

## Next Actions

1. **Still open: Q1 (primary reader) and Q2 (queue position vs the Android milestone / T007 in Ready for Review).** Working assumptions until told otherwise: primary reader is reviewer/QA with PM secondary, so the raw action log stays but collapses; and this queues *after* T007 lands.
2. ~~Open T008/T009~~ — **T008-T012 are already the Android milestone.** Opened as **T013** (B1) and **T014** (B2) instead; both are on the board with `tasks/TASK_GUIDE_T013.md` and `tasks/TASK_GUIDE_T014.md` written (2026-08-17).
3. **T013** — truthful verdicts: `ui_check`, `ui_wait_for`, screenshot dedupe/budget. C2, Risk Medium (changes which sessions report `passed`), P0, unblocked.
4. **T014** — grouped human-readable renderer + durations + console/network capture. C2, Risk Low, P1, blocked by T013; go/no-go gated on reviewing T013's output.
5. Update `orderly/.claude/docs/ui-smoke-testing-with-claude.md` alongside T013 - the anti-polling section currently teaches a workaround for a bug we would have fixed. Cross-repo, so it cannot be done from this worktree.
6. Regenerate one of the `smoke-reports/` sessions after T013 as a before/after artifact for the user to judge readability against.

---

## User Selection

> **Approved direction**: Option B — The Semantic Path, staged (B1 → B2, B2 gated on reviewing B1's output).
> **Q3 answered**: Additive only. `ui_assert` keeps its hard-fail meaning; `ui_check` is new. Adoption is handled by tool-description steering + the orderly doc update, not by reinterpreting existing semantics.
> **Extras**: all four folded in — `ui_wait_for`, screenshot dedupe/budget, per-action duration, console + network error capture.
> Approved by user on 2026-08-17.

### Sequencing note on the four extras

All four are in scope and none are deferred. They are split across the two slices by what they actually touch, so B1 stays reviewable:

- **T013 (B1)** — `ui_check`, `ui_wait_for`, screenshot dedupe/budget. All three are recording-and-semantics changes to `server.ts` / `session.ts` / `web.ts`, and all three shrink the artifact. They belong together.
- **T014 (B2)** — per-action duration, console + network error capture, the grouped renderer. Duration is pure rendering. Console/network capture is new data whose only purpose is to be *displayed*, so it wants the new renderer to land in.

Console + network capture is the one genuine scope addition here (M effort, Playwright `page.on('console')` / `page.on('requestfailed')`); it carries a decision of its own — whether a console error should affect session status or only be surfaced. Default assumption: **surface only, never fail the run**, consistent with the additive-only ruling. Flag at T014 planning if that is wrong.
