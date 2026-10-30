# TASK_REVIEW — T017: [Short Title]

> Sibling of `tasks/TASK_GUIDE_T017.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | pass | `test/web.test.ts` — 9 new getPageState tests (T017 AC1-AC7 + edge cases); red before the fix (9 fail), green after |
| Verification command run | pass | `node --import tsx --test test/web.test.ts && npx tsc --noEmit` at 2026-10-30 ~06:35Z: `ℹ tests 25 / ℹ pass 25 / ℹ fail 0`; tsc exit 0 (no output) |
| Negative cases hold | pass | empty / `display:none` / zero-size alerts -> `messages: []`; `aria-live=off` ignored; password `value` never used as name; unnamed + invisible elements excluded; `getPageState(undefined)` still `No active page` error |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| **UI: Visual regression (diff or verdict pasted)** | N/A | backend-only task, no UI surface |
| **UI: Design-system compliance (tokens/colors/typography verified)** | N/A | backend-only task, no UI surface |
| **UI: Responsiveness at target viewports** | N/A | backend-only task, no UI surface |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured before any implementation commit; unmodified code at HEAD 52ce70d):

```
$ date -u
Fri Oct 30 06:33:32 AM UTC 2026
$ node --import tsx scratchpad/demo.mts   # setContent(Requirement fixture); console.log(JSON.stringify(await getPageState(page)))
{"ok":true,"url":"about:blank","title":"","elements":[{"role":"combobox","name":"A"},{"role":"button","name":"Save"}]}
```

Both text inputs (Email, Search) are missing and there is no `messages` field, so "Password too short" is not reported.

**AFTER** (same script, same fixture, after commit d7bb169):

```
$ date -u
Fri Oct 30 06:35:27 AM UTC 2026
$ node --import tsx scratchpad/demo.mts
{"ok":true,"url":"about:blank","title":"","elements":[{"role":"textbox","name":"Email"},{"role":"textbox","name":"Search"},{"role":"combobox","name":"A"},{"role":"button","name":"Save"}],"messages":["Password too short"]}
```

**DELTA**: An agent calling `ui_get_page_state` now sees label-/placeholder-named inputs (`Email`, `Search`) and the visible validation text (`messages: ["Password too short"]`), so it can plan which fields to fill and react to errors.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
