# TASK_REVIEW — T045: Compact snapshot builds selectors on demand

> Sibling of `tasks/TASK_GUIDE_T045.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/web.test.ts` (20 `T045` tests: round-trip count, compact text identical with and without selectors, focus line, every lazy ref resolves to its element, click by ref, stale on replaced / removed / navigated, re-ordered sibling still reached, unverifiable ref stale, full struct unchanged, T042 cases in lazy mode, handles alive after a pass / a throw, shadow-root order, closed page, `within: @eN`); `test/multi-session.test.ts` (`T045 SC8/AC11`: the report step carries the resolved selector) |
| Verification command run | ☑ pass | Supervisor on 0a34f51: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` → tests 381, suites 9, pass 381, fail 0 |
| Negative cases hold | ☑ pass | Tests committed first (9bcef7f); on the starting commit the count test sees 9 `page.locator` calls for a 5-button page against 202 for a 200-element page (implementer's run; after: 1 and 1). Stale cases (replaced node, removed node, navigation) fail with the existing message in lazy mode; real page: an old ref after a navigating click is refused. No existing assertion was edited |
| verify | ☑ pass | pass — Supervisor real runs 2026-11-11 against 0a34f51. In-process on `en.wikipedia.org/wiki/Microsoft`: 724 ms and 452 ms (200 elements, 0 `page.locator` calls), 403 ms with `viewport: true`; refs resolved in 14–244 ms each to a selector matching exactly 1 element; click by ref navigated to `Talk:Microsoft`; the old ref was then stale. Through an MCP client against `src/stdio.ts`: same page 627 ms; saucedemo repro 30 / 7 / 24 / 7 / 24 elements straight after each click (T042 holds); the four baseline flows in `MODE=after` all completed (14.7 s for all four). AC 10 (at most 3 s) met. `verify` skill not installed: these runs are the live check |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `getPageState` / `snapshotPass` / `buildSelector` / `resolveRef` / `renderCompact` focus line in `src/tools/web.ts`, the one call in `src/server.ts`, tests, three docs |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 381/381 on 0a34f51, including the tool-list budget test |
| Code review | ☑ pass | Supervisor, inline. 0 P0 / P1. P2 recorded: the array handle is used in the compact mode only; `format: "full"` still takes one handle per candidate, because four T042 tests count `page.$$` calls (AC 9 holds for the compact mode). P3 accepted: a focused element that is not listed and that no selector reaches now prints as `role "name"` instead of being omitted; the in-page candidate walk copies Playwright's shadow-root order and is pinned by a test; lane_check `C2, 7 files, 622 lines, EXCEEDS (lines 622 > 500); unpredicted: README.md` (423 of the lines are tests; the README sentence about re-ordering had become wrong) |
| Security review | ☑ pass | Supervisor, inline: no findings. No new input reaches a selector or the page; a selector built at use is still verified by element identity (`locate`: one match, the listed node), so page content cannot steer a ref to another element; nothing is injected into the page |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not run in this session |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | one sentence of docs-site text; `test/site.test.ts` green |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | no new styles |
| **UI: Responsiveness at target viewports** | ☑ N/A | text-only docs edit |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair.

**BEFORE**: captured 2026-11-11T09:05Z on main @ bf2647d, by the Supervisor, in-process (`getPageState` on a headless Chromium page, 1280x720), `https://en.wikipedia.org/wiki/Microsoft`, with each page call timed:
```
getPageState {"keepRefs":true} 31217 ms, elements 167
   12467 ms   144x  locator role
    6958 ms    57x  locator positional
    4583 ms    28x  locator role (all handles arg)
    3159 ms    35x  locator role-nth
    1938 ms     2x  page.$$
     628 ms     1x  page.evaluateHandle
     454 ms     1x  page.evaluate(main pass)
     288 ms    43x  locator id
      13 ms     1x  page.$$eval messages
     724 ms        unaccounted (dispose etc.)

getPageState {"keepRefs":true,"viewport":true} 10900 ms, elements 91
    4270 ms    61x  locator role
    2235 ms     2x  page.$$
    2072 ms    24x  locator positional
     465 ms     3x  locator role (all handles arg)
     379 ms     1x  page.evaluate(main pass)
     311 ms     3x  locator role-nth
     197 ms    30x  locator id
     806 ms        unaccounted (dispose etc.)
```
An earlier run of the same page on the same commit: 23,778 ms (200 elements, 307 `page.locator` calls) and 19,308 ms with `viewport: true` (91 elements, 121 calls). `page.$$` took 4,330 handles.

**AFTER**: captured 2026-11-11 on 0a34f51, by the Supervisor, same page and method:
```
getPageState {"keepRefs":true,"selectors":false} 724 ms, elements 200 locator calls 0
   @e1 link "Jump to content" -> role=link[name="Jump to content"] 244 ms, matches 1
   @e120 link "Microsoft AI" -> role=link[name="Microsoft AI"] 160 ms, matches 1
   @e200 link "Azure" -> #mwQQ 14 ms, matches 1
getPageState {"keepRefs":true,"selectors":false,"viewport":true} 403 ms, elements 91 locator calls 0
getPageState {"keepRefs":true,"selectors":false} 452 ms, elements 200 locator calls 0
click by ref (link "Talk") -> {"ok":true}; url after click https://en.wikipedia.org/wiki/Talk:Microsoft
old ref after the navigation -> Ref @e1 is stale: the page changed ...
through MCP (src/stdio.ts): en.wikipedia.org/wiki/Microsoft 200 elements 627 ms
```

**DELTA**: A compact snapshot of a page with 4,330 interactive candidates takes about half a second instead of 19–31 s, because it no longer verifies a selector per listed element (about 300 page round trips before, none now) and no longer takes a handle per candidate. The selector behind a ref is built and verified when the ref is first used, 14–244 ms on this page. The reply text is unchanged.

**WITNESS**: Supervisor, 2026-11-11; `npm test` 381/381, the Wikipedia measurement, the saucedemo repro and the four-flow run executed by the Supervisor against 0a34f51; implementer: backend-developer on `worktree-agent-a00fe485bbf320e1c`.
