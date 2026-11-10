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
| verify | ☑ pass | independent re-drive of 7e0a7d1, live MCP on port 28851 (2026-11-10T07:42:04Z): beforeunload dismiss → "Stayed on …/bu.html", `ui_navigate` ok with `stayedOn`, session passed; accept → navigated, passed; alert-on-load answered after 17 s → no ANSI/"Call log:" in reply or report, soft row, passed; REST `/api/run-test` alert-on-load passed (auto-dismissed); confirm answered after 7 s → click ok (`opensDialog`); failing `ui_wait_for` during an alert → session failed (hard); newline message quoted on one line. Earlier drives: 24ec661 FAIL (REST P1), 4947c14 FAIL (beforeunload P2), both fixed. |
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

**WITNESS**: independent reviewer agent, 2026-11-10T07:42:04Z, live drive on port 28851 against 7e0a7d1 (PASS); Supervisor full `npm test` 179/179 + tsc at 7e0a7d1, traced under T031.

## Auto decisions

Mode: auto
1. Resumed the dead T031 agent's ~825 uncommitted lines instead of restarting the task — decided by the user in chat (2026-11-10, "I resume all four"), not by the Supervisor.
2. The independent Stage 4 verify FAIL (REST `/api/run-test` hangs on any `alert()`, P1) overrode the hook auto-verify PASS (log `.claude/verify-runs/T031-24ec6619d80f.log`), because it was reproduced live against `main` (176 ms pass vs 30 s error) — RULE: tasks/TASK_GUIDE_T031.md Files Must NOT Touch / REST shape unchanged for `src/api/run-test.ts`.
3. P2-1 (slow-answer "outcome unknown"), P2-2 (later real failures softened) and three cheap P3s (article, quoted/truncated dialog text, "Stayed on") fixed before Ready for Review; the single `stalled` slot with concurrent calls and the late outcome dropped on `ui_end_session` left as follow-up — RULE: skills/code-review/SKILL.md:28 "P3 | Style, minor improvement, documentation | Optional".
4. No rebase onto main@7cbe7a7: the gate blocks `git rebase` while any task is on the board, and the user chose to run the merges themselves — FACT: .claude/hooks/pre_bash_block_unsafe_merge.py:5 "Blocks git push/merge/rebase/pull commands if".
Checks: Supervisor full `npm test` 175/175 at 4947c14 and 179/179 at 7e0a7d1 (traced under T031); implementer session 48/48, reports 42/42, api-run-test 5/5, tsc clean.
Memory: memory/learnings.md — "Held native dialogs: opt-in only where an answerer exists, and assume the agent answers slower than any action timeout (T031)"; memory/MEMORY.md — index line for it
Merge notes vs T029 (main@7cbe7a7): `startSession(target, timeoutMs = DEFAULT_TIMEOUT_MS, onIdle?, options = {})` with `ui_start_session` passing `{ holdDialogs: true }` and REST keeping two args; keep main's `armIdleTimer` tail plus this branch's `attachDialogHandler(page, log, hold)`; call `releaseDialog(session.page)` in main's `closeIdleSession` after `sessions.delete` and before `closeBrowser`; delete this branch's module-level `callContext` and widen main's store to `{ sessionId?, dialogCall? }`; delete the `server.registerTool` monkey-patch and move the dialog guard into `registerSessionTool` after `owned.resolve` (inside main's `beginCall`/`endCall`); register `ui_click_outside`, `ui_dialog` and `ui_step` via `registerSessionTool(`; re-apply the `ui_click` options inside main's wrapper; use `callSessionId()` instead of `activeSessionId`; re-derive the tool count (+2); add tests for a held dialog in session A not blocking session B, and for idle close dismissing a held dialog (`answeredBy: "session-end"`).
Not done: merge into main (user runs it); rebuilt-container drive (SC 11); re-verify of 4947c14 FAILED (deliberate beforeunload Stay failed the session) → fixed in 7e0a7d1, re-verify PASS. Follow-ups (P3): missing ")" and separator before "Page now:" in the `ui_dialog` reply; single `stalled` slot; late outcome dropped on `ui_end_session`.
