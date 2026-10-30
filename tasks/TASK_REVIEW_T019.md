# TASK_REVIEW — T019: [Short Title]

> Sibling of `tasks/TASK_GUIDE_T019.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | [test file path(s) — required before Done] |
| Verification command run | ☐ pass / ☐ fail | [paste actual output] |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | [what was reviewed vs. skipped, and why] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| **UI: Visual regression (diff or verdict pasted)** | ☐ pass / ☐ fail / ☐ N/A | [screenshot path or LLM verdict — required for UI tasks, Hard-Stop Gate 6] |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ pass / ☐ fail / ☐ N/A | [method used + output] |
| **UI: Responsiveness at target viewports** | ☐ pass / ☐ fail / ☐ N/A | [viewports tested, any overflow findings] |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured 2026-10-30T07:26:32Z, UTC, on commit 287fba0, before any T019 implementation commit):

```
$ date -u
Fri Oct 30 07:26:32 AM UTC 2026
$ grep -A1 "registerTool(" src/server.ts | grep -o '"ui_[a-z_]*"' | sort -u
"ui_assert" "ui_check" "ui_click" "ui_end_session" "ui_fill" "ui_get_page_state"
"ui_navigate" "ui_start_session" "ui_step" "ui_take_screenshot" "ui_wait_for"
(one per line in the real output; none of the five new tools is present)
$ for t in ui_select_option ui_press_key ui_hover ui_set_checked ui_scroll; do grep -c "\"$t\"" src/server.ts; done
ui_select_option occurrences in server.ts: 0
ui_press_key occurrences in server.ts: 0
ui_hover occurrences in server.ts: 0
ui_set_checked occurrences in server.ts: 0
ui_scroll occurrences in server.ts: 0
$ fill(page, "#c", "vn") on <select id="c"> (npx tsx, output truncated to 200 chars)
{"ok":false,"error":"locator.fill: Error: Element is not an <input>, <textarea> or [contenteditable] element\nCall log:\n ... waiting for locator('#c') ..."}
```
(The `grep -o 'registerTool(\s*"..."'` form from the spawn prompt matches nothing because `registerTool(` and the tool name are on different lines; `grep -A1` is the equivalent used here.)

**AFTER**: [same command, post-change] OR [verbatim excerpt of the new content]

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
