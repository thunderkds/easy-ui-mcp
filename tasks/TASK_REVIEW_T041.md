# TASK_REVIEW — T041: Trim the tool list

> Sibling of `tasks/TASK_GUIDE_T041.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/health.test.ts`: the `tools/list` test now asserts 26 tools and `JSON.stringify(tools).length <= 20_000` (red at 27,207 in 290783e, green in ecc3f41) |
| Verification command run | ☑ pass | Supervisor on ecc3f41: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` → tests 334, suites 8, pass 334, fail 0 (traced under T041) |
| Negative cases hold | ☑ pass | Budget test failed on the starting commit with "tools array is 27207 characters; the budget is 20000". Schema-unchanged check by the Supervisor: with every string `description` removed, the tools arrays of main and ecc3f41 are identical (names, argument names, types, enums, limits, `required`) |
| verify | ☑ pass | pass — Supervisor real run 2026-11-11T04:20Z against `src/stdio.ts` of ecc3f41 through an MCP client: `tools/list` returns 26 tools in 19,017 characters (was 27,207); the four baseline flows completed with refs (807 / 1,169 / 4,871 / 5,477 tokens). The 17 "Facts that must survive" were each read in the new tool list and are present. The `verify` skill is not installed in this session; this run is the live check |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `src/server.ts` description strings and `test/health.test.ts` only; `test/docs-tools.test.ts` and `test/stdio.test.ts` green unchanged |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 334/334 on ecc3f41 |
| Code review | ☑ pass | 0 findings; lane_check `C1, 2 files, 225 lines, FITS`. Report: `reports/code-review_worktree-agent-a6901d89c9f470270_20261111T112247.html` |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not run in this session |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | no UI change |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | no UI change |
| **UI: Responsiveness at target viewports** | ☑ N/A | no UI change |

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

**BEFORE**: captured 2026-11-11T04:12:50Z on main @ 483f631 (after T040, before any T041 commit), by the Supervisor:
```
$ (initialize + tools/list over stdin) | npx tsx src/stdio.ts | node -e '…JSON.stringify(tools).length'
2026-11-11T04:12:50.827Z tools 26 chars 27207
```
The `tools/list` tools array is 27,207 characters (about 6,802 tokens). The `session_id` argument description is repeated in full on 25 tools.

**AFTER**: captured 2026-11-11T04:20Z on ecc3f41, by the Supervisor:
```
$ (initialize + tools/list over stdin) | tsx src/stdio.ts | node -e '…JSON.stringify(tools).length'
before 27207 after 19017 schema identical: true
$ MODE=after EASY_UI_SERVER_ROOT=<T041 worktree> node_modules/.bin/tsx docs/experiments/token-baseline.mts
schema tokens 4754
```

**DELTA**: Every conversation that connects to the server now pays about 4,750 tokens for the tool list instead of about 6,800, with the same 26 tools and arguments; a test stops the list growing past 20,000 characters unnoticed.

**WITNESS**: Supervisor, 2026-11-11; `npm test` 334/334, the tool-list comparison and the four-flow run executed by the Supervisor against ecc3f41 and traced in `memory/event-trace/T041.jsonl`; implementation by backend-developer in a separate worktree.