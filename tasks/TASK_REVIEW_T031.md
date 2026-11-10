# TASK_REVIEW — T031: Close and answer — click outside, `ui_click` options, native dialogs

> Sibling of `tasks/TASK_GUIDE_T031.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | pass | `test/web.test.ts` (AC1-6: click outside, options, describeClick), `test/session.test.ts` (AC7-9, 11-14: held dialogs, preset, timeout, navigate, beforeunload, legacy page), `test/reports.test.ts` (AC6/7/10 describe). Docs: `test/docs-tools.test.ts`, `test/site.test.ts` |
| Verification command run | pass | web 60/60, session 41/41, reports 41/41, docs-tools 1/1, `npx tsc --noEmit` clean (implementer, 2026-11-10, post-change) |
| Negative cases hold | pass | no safe point -> isError naming Escape; control-only surroundings -> nothing clicked; position outside box -> error; 2 matches -> error; dialog waiting -> other tools refused; invalid DIALOG_TIMEOUT_MS -> default |
| verify | pass | live MCP drive on spare port 18781 (temp server copy, removed): ui_click_outside closed a backdrop (37ms, "on div#bd"); right+force click; ui_click on a confirm button returned in 37ms with the waiting text; ui_get_page_state refused; ui_dialog accept -> "The interrupted call then returned: Clicked "#del""; report shows all three. Rebuilt-container drive (SC 11) NOT done by the implementer |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | pass | reviewed src/server.ts (every tool now routes through the guard), session.ts, web.ts click, reports describe; skipped site CSS/api. isFatalOutcome, resolveUniqueLocator, run-test.ts untouched |
| Full smoke suite still green (no regression) | pass | `npm test` under the port lock: tests 166, pass 166, fail 0 |
| **UI: Visual regression (diff or verdict pasted)** | N/A | no UI change (docs page text only) |
| **UI: Design-system compliance (tokens/colors/typography verified)** | N/A | no UI change |
| **UI: Responsiveness at target viewports** | N/A | no UI change |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**: captured 2026-11-10 against the unmodified code (HEAD d460935) with a tsx script (fixture: fixed fullscreen backdrop with a sibling centred panel and an `onclick` that removes the backdrop; a button that writes `confirm('Delete?')` to the DOM), via `startSession` + `click()`:

```
2026-11-10T04:46:19.450Z click #backdrop -> {"ok":false,"error":"locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for locator('#backdrop')\n    - locator resolve (5024ms) ...
2026-11-10T04:46:24.517Z click #del (confirm) -> page text: confirm returned false
2026-11-10T04:46:24.540Z logged actions mentioning a dialog: []
```

The backdrop click times out after 5s (the panel covers its centre); `confirm()` is silently answered `false`, and the session records no dialog.

**AFTER**: 2026-11-10, post-change, live MCP drive (temp server copy on port 18781, SDK client, same two fixtures):

```
[58ms] ui_click_outside(#p) ok: Clicked outside "#p" at 128,360 (on div#bd)
[15ms] ui_click(#row, button right, force) ok: Right-clicked "#row" (forced)
[37ms] ui_click(#del) ok: Browser is waiting on a confirm dialog: "Delete item?". Answer with ui_dialog accept or dismiss (prompt: add text).
[4ms]  ui_get_page_state ERROR: A confirm dialog is waiting: "Delete item?" — answer it with ui_dialog first
[7ms]  ui_dialog(accept) ok: Accepted the confirm dialog "Delete item?". The interrupted call then returned: Clicked "#del"
report: Clicked outside #p (on div#bd) / Right-clicked #row (forced) / Browser confirm dialog "Delete item?" — accepted (answered by agent)
```

**DELTA**: The agent can close a modal by clicking outside it (in 58ms instead of a 5s timeout), click as a user does (right, double, modifier, offset, forced), and is asked about each native dialog and answers it, with every dialog and its answer shown in the report.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
