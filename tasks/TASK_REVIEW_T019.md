# TASK_REVIEW — T019: Missing interaction primitives

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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | pass (implementer-run; reviewer to confirm) | `test/web.test.ts` (14 new T019 tests: AC1-6, AC8, edges), `test/reports.test.ts` (3 new: AC7 sentences, truncation, HTML-escape). Run 2026-10-30T07:29:16Z: `node --import tsx --test test/web.test.ts test/reports.test.ts test/session.test.ts` -> `ℹ tests 101 / ℹ pass 101 / ℹ fail 0`. The reports test was seen red before implementation; the web tests were written first but their red run was an import failure, not individually observed. |
| Verification command run | pass | `node --import tsx --test test/web.test.ts test/reports.test.ts test/session.test.ts && npx tsc --noEmit` -> `ℹ tests 101`, `ℹ pass 101`, `ℹ fail 0`, then `tsc exit 0` (no output). |
| Negative cases hold | pass | Unknown option (`No option "Atlantis" in "#c"; available: "United States", "Vietnam"`), unknown key (`keyboard.press: Unknown key: "Nope"`), non-checkbox / radio uncheck, non-select, 0 and 2 matches for every tool: all asserted in `test/web.test.ts`. |
| verify | ☐ pending Supervisor | Implementer drove a scratch copy of `server.ts` on port 18765 (not the user's container on 8765) with the MCP client SDK: all five tools listed and callable, report shows readable sentences, session status `failed` after the two deliberate failures (hard, with failure screenshots) -- pass for the scratch-server drive. The guide's live drive against the rebuilt container on 8765 is NOT done: that port belongs to the user's running container and rebuilding it needs the user's OK. The Supervisor does it at integration. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pending reviewer | Changed: `src/tools/web.ts` (additive), `src/server.ts` (additive: imports, `TOOL` consts, `runInteraction`, 5 registrations), `src/reports/index.ts` (`describe()` only), README tool list, 2 test files. No existing function body touched. |
| Full smoke suite still green (no regression) | pass, with 2 pre-existing failures | `health` 2/2, `codex-mapping` 1/1, `harness-snapshot` 3/3, `session`/`web`/`reports` all pass. `test/api-run-test.test.ts` 2 of 4 fail (`report_url should point at a real file on disk`, and the unreachable-URL case). Identical 2 failures on pristine `287fba0` checked out in a throwaway worktree, so not caused by T019. |
| **UI: Visual regression (diff or verdict pasted)** | N/A | Pure backend task, no UI component. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | N/A | Pure backend task, no UI component. |
| **UI: Responsiveness at target viewports** | N/A | Pure backend task, no UI component. |

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

**AFTER** (2026-10-30, after commit 7d26cb4; scratch server on port 18765, MCP client SDK):

```
$ grep -A1 "registerTool(" src/server.ts | grep -o '"ui_[a-z_]*"'   # names now go through the TOOL const, so verified through tools/list instead:
tools/list filtered -> [ 'ui_select_option', 'ui_press_key', 'ui_hover', 'ui_set_checked', 'ui_scroll' ]
ui_select_option {"selector":"#c","value":"Vietnam"} ok - Selected "Vietnam" in "#c"
ui_select_option {"selector":"#c","value":"Atlantis"} ERROR - No option "Atlantis" in "#c"; available: "United States", "Vietnam"
ui_press_key {"key":"Enter","selector":"#q"} ok - Pressed Enter in "#q"
ui_hover {"selector":"#m"} ok - Hovered over "#m"
ui_set_checked {"selector":"#t","checked":true} ok - Set "#t" to checked
ui_scroll {"selector":"#foot"} ok - Scrolled "#foot" into view
ui_scroll {} ok - Scrolled down one page
ui_press_key {"key":"Nope"} ERROR - keyboard.press: Unknown key: "Nope"
ui_scroll {} (before any navigate) ERROR - No active page -- call ui_navigate first
```
Report sentences from that session's HTML: `Selected "Vietnam" in #c`, `Pressed Enter in #q`, `Hovered over #m`, `Set #t to checked`, `Scrolled #foot into view`, `Scrolled down one page`. Session status: failed (hard failures recorded). The select-on-`<select>` case now succeeds via `selectOption(page,"#c","vn")` -> `{ok:true}` (test `selectOption selects by option value and by visible label`).

**DELTA**: An agent can now choose a `<select>` option, press keys (Enter submits a form), hover menus open, check/uncheck boxes and scroll lazy pages, each as one tool that is logged and fails like `ui_click`.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
