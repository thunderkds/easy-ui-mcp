# TASK_REVIEW — T042: Snapshot taken while the page re-renders comes back empty

> Sibling of `tasks/TASK_GUIDE_T042.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/web.test.ts`: 9 `T042` tests (re-render SC1, never settles SC2, single pass SC3, refs after a retry SC4, empty page SC5, cap note joined AC6, ticking clock / animation, destroyed context, closed page) |
| Verification command run | ☑ pass | Supervisor on 8fc7021: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` → tests 343, suites 8, pass 343, fail 0 (traced under T042) |
| Negative cases hold | ☑ pass | Red run by the implementer on the starting commit: SC1 failed with `[]` instead of `['Final 1','Final 2','Final 3']`; SC2, SC4, AC6 and the destroyed-context test failed too. Stable pages take one pass (SC3 counts `page.$$` calls) |
| verify | ☑ pass | pass — Supervisor real run 2026-11-11 against `src/stdio.ts` of 8fc7021 through an MCP client: on saucedemo the snapshot straight after each click lists 30 / 7 / 24 / 7 / 24 elements (main: 0 every time). Stable pages unchanged: Wikipedia, Hacker News and TodoMVC snapshots take the same time as on main and carry no "still changing" note. The four baseline flows pass with no wait before snapshots (807 / 1,210 / 4,591 / 5,465 tokens). The `verify` skill is not installed in this session; this run is the live check |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `getPageState` in `src/tools/web.ts`, its tests, one RUNBOOK row; `src/server.ts` untouched (tool list still 19,017 characters) |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 343/343 on 8fc7021 |
| Code review | ☑ pass | 0 P0 / P1 / P2; 3 P3 accepted (budget overshoot on a large never-settling page, 2.7–2.9 s; a permanently unverifiable visible element would cost 2 s per snapshot, not seen; lane_check `C1, 3 files, 291 lines, EXCEEDS (lines 291 > 250)`, 197 lines are tests). Report: `reports/code-review_worktree-agent-a47fe5f3f25bab868_20261111T115055.html` |
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

**BEFORE**: captured 2026-11-11 on main @ f1c5b2a, by the Supervisor, through an MCP client against `src/stdio.ts` (repro script: click, then `ui_get_page_state` at once, then again 800 ms later):
```
after login click: 0 elements, 103 ms; url: https://www.saucedemo.com/inventory.html
click .shopping_cart_link: immediate 0 elements (74 ms) | after 800ms 7 | url: https://www.saucedemo.com/cart.html
click #continue-shopping: immediate 0 elements (93 ms) | after 800ms 24 | url: https://www.saucedemo.com/inventory.html
click .shopping_cart_link: immediate 0 elements (54 ms) | after 800ms 7 | url: https://www.saucedemo.com/cart.html
click #continue-shopping: immediate 0 elements (87 ms) | after 800ms 24 | url: https://www.saucedemo.com/inventory.html
```
In-process probe at the same moment: `document.readyState` is `complete`, the DOM still holds 8 buttons, and the snapshot lists 0 elements.

**AFTER**: captured 2026-11-11 on 8fc7021, by the Supervisor, same repro script against the task branch:
```
after login click: 30 elements, 297 ms; url: https://www.saucedemo.com/inventory.html
click .shopping_cart_link: immediate 7 elements (204 ms) | after 800ms 7 | url: https://www.saucedemo.com/cart.html
click #continue-shopping: immediate 24 elements (211 ms) | after 800ms 24 | url: https://www.saucedemo.com/inventory.html
click .shopping_cart_link: immediate 7 elements (176 ms) | after 800ms 7 | url: https://www.saucedemo.com/cart.html
click #continue-shopping: immediate 24 elements (247 ms) | after 800ms 24 | url: https://www.saucedemo.com/inventory.html
```

**DELTA**: An agent can take a snapshot straight after a click that changes the route and gets the new page's elements instead of an empty list; the snapshot costs 100–200 ms more only when the page was re-rendering.

**WITNESS**: Supervisor, 2026-11-11; `npm test` 343/343, the saucedemo repro and the four-flow run executed by the Supervisor against 8fc7021 and traced in `memory/event-trace/T042.jsonl`; implementation by backend-developer in a separate worktree.