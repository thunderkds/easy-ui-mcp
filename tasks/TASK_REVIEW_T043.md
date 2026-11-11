# TASK_REVIEW — T043: Snapshot scope (viewport, within)

> Sibling of `tasks/TASK_GUIDE_T043.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/web.test.ts` (16 `T043` tests: viewport at the current scroll position, edge-straddling element, within by selector / `@eN` / `@oN`, failures, both scopes, notes, cap after scope, refs, page-wide overlays / focus / messages, vanishing root), `test/multi-session.test.ts` ("T043: viewport and within on ui_get_page_state") |
| Verification command run | ☑ pass | Supervisor on 7dbd379: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` → tests 360, suites 9, pass 360, fail 0 (traced under T043) |
| Negative cases hold | ☑ pass | Tests committed red first (80a8fd6). `within` matching nothing, several elements or a stale ref is an error with no list (real page: `within: Selector ".vector-header-container" matched 2 elements; expected exactly 1`). No argument, `viewport: false` and `within: undefined` give the plain reply |
| verify | ☑ pass | pass — Supervisor real run 2026-11-11T08:22Z against `src/stdio.ts` of 7dbd379 through an MCP client: Wikipedia `viewport: true` 3,310 of 6,182 characters (54%, 100 of 512 elements, note present); Hacker News 3,642 of 5,474 (67%, 125 of 198); saucedemo login unchanged (3 elements, no note); `within: "#vector-toc"` lists 13 of 512 elements with the note. The four baseline flows pass (807 / 1,210 / 4,623 / 5,486 tokens). AC 10 (at most 65%) is met on Wikipedia and missed by 2 points on Hacker News. The `verify` skill is not installed in this session; this run is the live check |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `getPageState` / `snapshotPass` / `REF_ARGUMENTS` in `src/tools/web.ts`, the `ui_get_page_state` handler in `src/server.ts`, tests, four docs |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 360/360 on 7dbd379; tool list 19,362 characters (budget 20,000) |
| Code review | ☑ pass | 0 P0 / P1; 1 P2 recorded (AC 10 partly missed, see verify row); 3 P3 accepted; lane_check `C2, 8 files, 448 lines, FITS`. Report: `reports/code-review_worktree-agent-a888cb9a44729fe10_20261111T152518.html` |
| Security review | ☑ pass | no findings. Report: `reports/security-review_worktree-agent-a888cb9a44729fe10_20261111T152518.html` |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not run in this session |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | docs-site text only; `test/site.test.ts` green |
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

**BEFORE**: captured 2026-11-11T04:51Z on main after T042, by the Supervisor, through an MCP client against `src/stdio.ts` (the `viewport` and `within` arguments are ignored: the reply is the unscoped page):
```
en.wikipedia.org/wiki/Playwright_(softwa | unscoped 6140 chars 200 els | viewport:true 6140 chars 200 els (100%) | note: Showing first 200 of 512 elements; use a CSS selector for the rest
news.ycombinator.com/ | unscoped 5505 chars 198 els | viewport:true 5505 chars 198 els (100%) | (no note)
www.saucedemo.com/ | unscoped 113 chars 3 els | viewport:true 113 chars 3 els (100%) | (no note)
within .vector-header-container: 6140 chars 200 els | note: Showing first 200 of 512 elements; use a CSS selector for the rest
within (2 matches): 200 els
```

**AFTER**: captured 2026-11-11T08:22Z on 7dbd379, by the Supervisor, same script against the task branch:
```
en.wikipedia.org/wiki/Playwright_(softwa | unscoped 6182 chars 200 els | viewport:true 3310 chars 100 els (54%) | note: Showing 100 of 512 elements (viewport only); scroll, or call without viewport, for the rest
news.ycombinator.com/ | unscoped 5474 chars 198 els | viewport:true 3642 chars 125 els (67%) | note: Showing 125 of 198 elements (viewport only); scroll, or call without viewport, for the rest
www.saucedemo.com/ | unscoped 113 chars 3 els | viewport:true 113 chars 3 els (100%) | (no note)
within .vector-header-container: ERROR within: Selector ".vector-header-container" matched 2 elements; expected exactly 1
within #vector-toc: 546 chars 13 els | note: Showing 13 of 512 elements (within "#vector-toc"); call without within for the rest
```

**DELTA**: An agent can ask for only what is on screen or only what is inside one element: a Wikipedia snapshot drops from 6,182 to 3,310 characters with `viewport: true` and to 546 with `within` on the table of contents, and the reply says how many elements were left out.

**WITNESS**: Supervisor, 2026-11-11; `npm test` 360/360, the scope measurement and the four-flow run executed by the Supervisor against 7dbd379 and traced in `memory/event-trace/T043.jsonl`; implementation by backend-developer in a separate worktree.