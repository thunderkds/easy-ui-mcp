# TASK_REVIEW — T040: Compact page state with refs

> Sibling of `tasks/TASK_GUIDE_T040.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

<!-- Optional: the final report, only for a task run in auto mode (the user's `[auto]` or `[admin]` tag; with `[admin]`, the `Not done:` line names `merge (admin: after the auto verify pass)`,
`docs/claude-md/tracks.md` `## Auto mode`). To use it, copy the block below out of this comment, to this
place, and replace every <...>. Keep `Mode: auto` as its first line, exactly as written: T182's hook reads
it. Write it to this file before the run ends; the chat message is a copy, not the report. The same
block is the Supervisor's final chat message. It is not the `delivery-report` page and not
Evidence. A taste decision (what the user wants) also ends with the flag. Write `DEBATED` only when ≥2
Advocate `Agent` calls ran for that question, naming each Advocate's option. A decision with no Advocates is
labelled `RULE`, `FACT` or `SAFER OPTION`, never `DEBATED`. A decision flagged `⚠ decided for you` is a choice, and is never labelled `FACT`. A
safety action a rule requires (for example the backup before a delete) is `RULE` without the flag.
At Risk Medium or High, a `RULE:` counts only when it names a written rule (`path:line`,
`path § <heading>`, or `docs/claude-md/tracks.md` `### <section>`), and a `FACT:` needs a Citation
(`path:line "quoted text"`); without one it is a choice and must be `DEBATED`. Good: `2. backed up the CSV
— RULE: `docs/claude-md/tracks.md` `### Stops that stay``. Bad: `1. kept recurring.csv — RULE: Surgical Changes`.
`Memory:` records the diff-driven memory pass you run before you stop: each entry written, or `nothing new`.
After an auto verify pass the hook, never you, adds `Closed: row moved to Done <date> — …` and moves the row,
or adds `Paused: done not moved — <reason>`. It moves the row only when this block holds `Mode: auto`, a
numbered decision, `Checks:`, `Memory:`, the `Not done:` auto verify slot with its result, and `Not done:`
naming the merge — no `<...>` left (`docs/claude-md/tracks.md` `### Auto close-out`).

## Auto decisions

Mode: auto
1. <what was decided> — RULE: <the rule>
2. <what was decided> — FACT: <path>:<line> "<quoted text>"
3. <what was decided> — DEBATED: <option> (Advocate 1: <its proposal>; Advocate 2: <its proposal>) ⚠ decided for you — please review
4. <what was decided> — SAFER OPTION: <why> ⚠ decided for you — please review
Paused: <only when a stop that stays paused the task: which one, and why>
Checks: tests `<command>` — <result>; reviews <skill — result>; real run `<command>` — printed `<what it printed>` (auto-checked, not /verify)
Memory: <each entry the memory pass wrote, as `file — entry` | nothing new>
Not done: merge (yours); <auto verify: running (T182) | auto verify: <result> | /verify (yours)>

-->

## Evidence

| Check | Result | Notes |
|-------|--------|-------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/web.test.ts` (15 T040 tests: renderer, ref resolution, stale cases, per-page tables, state rules), `test/multi-session.test.ts` ("T040: compact page state and refs", 6 tests), `test/dialog-sessions.test.ts` (held dialog refuses a ref) |
| Verification command run | ☑ pass | Supervisor on 210de6c: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` → tests 334, suites 8, pass 334, fail 0 (traced under T040) |
| Negative cases hold | ☑ pass | Mutation run by the implementer: removing the identity check (`hit.position !== 0`) in `resolveRef` fails both stale-ref tests (re-ordered list, look-alike node); restored. Stale, unknown, `@e0`, other-session and no-snapshot refs are refused and nothing is clicked |
| verify | ☑ pass | pass — Supervisor real run 2026-11-11T04:07Z against `src/stdio.ts` of 210de6c through an MCP client: the four baseline flows (TodoMVC, Saucedemo login + checkout, Wikipedia, Hacker News) completed driven only by `@eN` refs plus one CSS selector; traffic 807 / 1,169 / 4,871 / 5,483 tokens, all within AC 8 limits (910 / 1,330 / 5,400 / 6,050). The `verify` skill is not installed in this session; this run is the live check |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `src/tools/web.ts`, `src/server.ts`, the three test files, README / RUNBOOK / `site/index.html` / PROJECT_SPEC / PRD diffs, and the only caller of `getPageState` in `src/`. Not re-read: `session.ts`, `reports/index.ts`, `api/run-test.ts`, `stdio.ts` (unchanged) |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 334/334 on 210de6c |
| Code review | ☑ pass | 0 P0; 1 P1 fixed in 210de6c (a refused ref was a hard failure: now soft, session still passes, no failure screenshot); 2 P2 fixed (`ui_drag` description, "never a ref" wording); P3 accepted: lane_check `C2, 10 files, 795 lines, EXCEEDS (lines 795 > 500)` (511 lines are tests), tool list 6,705 → 6,802 tokens (T041). Report: `reports/code-review_worktree-agent-a029d373b63504de0_20261111T110930.html` |
| Security review | ☑ pass | no findings: strict ref pattern and bounds, identity check before any action, per-page tables behind the session lookup, snapshot lines cannot be forged by page content, password value never read. Report: `reports/security-review_worktree-agent-a029d373b63504de0_20261111T110930.html` |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not run in this session |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | no UI change beyond docs-site text; `test/site.test.ts` green |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | no new styles |
| **UI: Responsiveness at target viewports** | ☑ N/A | text-only docs edit |

-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | [test file path(s) — required before Done] |
| Verification command run | ☐ pass / ☐ fail | [paste actual output] |
| Negative cases hold | ☐ pass / ☐ fail | [paste the red run against the prior content, or the mutation diff (`git diff --stat`, non-empty) before each verdict] |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☐ pass / ☐ fail / ☐ N/A | [screenshot path or LLM verdict — required for UI tasks, Hard-Stop Gate 6] |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ pass / ☐ fail / ☐ N/A | [method used + output] |
| **UI: Responsiveness at target viewports** | ☐ pass / ☐ fail / ☐ N/A | [viewports tested, any overflow findings] |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-11 on main @ 2669cfa (no source change), by the Supervisor:
```
$ node_modules/.bin/tsx docs/experiments/token-baseline.mts
schema tokens 6705
== todomvc (small app): 18 calls, 3 snapshots
 A current       {"requests":368,"snapshots":747,"otherReplies":298,"total":1413,"cumulative":11032}
== saucedemo (login + checkout): 25 calls, 6 snapshots
 A current       {"requests":389,"snapshots":1449,"otherReplies":255,"total":2092,"cumulative":26194}
== wikipedia (long article): 14 calls, 3 snapshots
 A current       {"requests":223,"snapshots":25759,"otherReplies":211,"total":26192,"cumulative":200655}
== hacker news (link list): 14 calls, 4 snapshots
 A current       {"requests":215,"snapshots":26674,"otherReplies":197,"total":27086,"cumulative":154592}
```
`ui_get_page_state` replies with JSON carrying a selector per element; `ui_click` with `@e1` fails as an invalid selector. Full numbers: `docs/experiments/token-baseline-2026-11-11.md`.

**AFTER**: captured 2026-11-11T04:07Z on 210de6c, by the Supervisor:
```
$ MODE=after EASY_UI_SERVER_ROOT=<T040 worktree> node_modules/.bin/tsx docs/experiments/token-baseline.mts
schema tokens 6802
== todomvc (small app): 18 calls, 3 snapshots
 A current       {"requests":289,"snapshots":244,"otherReplies":274,"total":807,"cumulative":6672}
== saucedemo (login + checkout): 25 calls, 6 snapshots
 A current       {"requests":358,"snapshots":580,"otherReplies":231,"total":1169,"cumulative":14819}
== wikipedia (long article): 14 calls, 3 snapshots
 A current       {"requests":211,"snapshots":4474,"otherReplies":187,"total":4871,"cumulative":36241}
== hacker news (link list): 14 calls, 4 snapshots
 A current       {"requests":195,"snapshots":5115,"otherReplies":173,"total":5483,"cumulative":39713}
```
`ui_get_page_state` now replies e.g. `@e1 textbox "Username"` / `@e3 button "Login"`, and `ui_click` with `@e3` clicks that button (reply: `Clicked "#login-button"`).

**DELTA**: An agent can read a page as one short line per element and act on `@eN` refs; the same four flows cost 1.7× to 5.4× less tool traffic (1,413 → 807, 2,092 → 1,169, 26,192 → 4,871, 27,086 → 5,483 tokens), and a ref that no longer points at the listed element is refused instead of acting on another one.

**WITNESS**: Supervisor, 2026-11-11; `npm test` 334/334 and the real MCP run above executed by the Supervisor against 210de6c and traced in `memory/event-trace/T040.jsonl`; implementation by backend-developer in a separate worktree.