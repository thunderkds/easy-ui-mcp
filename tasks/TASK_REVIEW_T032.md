# TASK_REVIEW — T032: Real users, real sizes

> Sibling of `tasks/TASK_GUIDE_T032.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | pass | `test/web.test.ts`, `test/session.test.ts`, `test/reports.test.ts`, `test/docs-tools.test.ts` |
| Verification command run | pass | web 71/71, session 36/36, reports 42/42, docs-tools 1/1, `npx tsc --noEmit` clean (2026-11-10, under the port-8765 lock) |
| Negative cases hold | pass | unknown device -> isError listing names; first-page `back` -> isError "No earlier history entry"; `scroll` at the end -> "already at the bottom (end reached)"; `selector`+`fullPage` rejected |
| verify | ☑ pass | independent re-drive of b5fe3ef, live MCP on port 28821 (2026-11-10T06:40:36Z): 40000px fullPage+inline → inline 640x8000, file 1280x16000, scaled note; 30000px-wide → file 3840x15000 (inline 1280x5000); iPhone 13 40000px → file 2940x15999, inline 1280x6966; `ui_type` masks one-time-code/cc-number/-webkit-text-security/password/new-password (reply "••••", 0 secret hits in report JSON+HTML), plain field unmasked; device "constructor"/"__proto__" → isError; regressions OK. First review drive (5f4faf7, port 28801) also PASS on AC1–AC11. Hook auto-verify on 5f4faf7 was "blocked (no single verdict line)", log .claude/verify-runs/T032-5f4faf763571.log |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | N/A (pending reviewer) | Changed: session.ts, web.ts, server.ts, reports/index.ts + their tests and docs. `isFatalOutcome`, T013 screenshot dedupe and `src/api/run-test.ts` unchanged |
| Full smoke suite still green (no regression) | pass | `npm test`: tests 173, pass 173, fail 0 |
| **UI: Visual regression (diff or verdict pasted)** | N/A | No UI change |
| **UI: Design-system compliance (tokens/colors/typography verified)** | N/A | No UI change |
| **UI: Responsiveness at target viewports** | N/A | No UI change (the tool itself enables 375/1280 checks) |

Security note for the reviewer (Medium risk): `ui_type` masks the text as `••••` in the result and report when the target is `type=password`; the live report JSON and HTML contained 0 occurrences of the typed secret.

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured against the unmodified code, before any implementation commit; worktree `/home/thunderkds/workspace/pets/easy-ui-mcp/.claude/worktrees/agent-aaa9a31fc40ff0d23`):

```
$ date -u
Tue Nov 10 04:44:37 UTC 2026
$ node --import tsx <scratchpad>/t032/before.mts
innerWidth with no way to choose: 1280
input events after fill('abc'): 1
exports ui_type/history/set_viewport: typeText=false navigateHistory=false setViewport=false
scroll(#panel) scrollTop: 0
screenshot result keys: ok,path
```


**AFTER** (same kind of probe, post-change; run from the same worktree, 2026-11-10 05:09 UTC):

```
$ node --import tsx <scratchpad>/t032/after.mts
innerWidth with viewport option 375: 375
input events after fill('abc'): 1
input events after typeText('abc'): 3
exports ui_type/history/set_viewport: typeText=true navigateHistory=true setViewport=true
scroll(#panel) scrollTop: 200
screenshot result keys: ok,path,imageBase64
```

**DELTA**: An agent can now start a session at a phone size or device profile, type key by key, go back/forward/reload, scroll inside a panel to its end, and receive screenshots as images it can look at.

**WITNESS**: independent reviewer agent, 2026-11-10T06:40:36Z, live drive on port 28821 against b5fe3ef (PASS); earlier independent drive 2026-11-10T06:14Z on port 28801 against 5f4faf7 (PASS on all ACs); Supervisor full `npm test` 178/178 at b5fe3ef, traced under T032.

## Auto decisions

Mode: auto
1. Resumed the dead T032 agent's worktree instead of restarting the task — decided by the user in chat (2026-11-10, "I resume all four"), not by the Supervisor.
2. Stage 4 P1 (inline image only width-capped, 1280x16000 > 8000px API limit) and S-1 Medium (OTP/card text from `ui_type` shown in the report) fixed before Ready for Review rather than waived — RULE: skills/code-review/SKILL.md:27 "P2 | Code quality, maintainability, non-critical test gap | Recommended" (P1 and Medium security rank above it and are not optional).
3. Cheap P2-1/P2-2/P2-4 and P3-1 fixed on the branch; P3-2 (`ui_type` length cap) and P3-3 (scroll message wording) left as follow-up — RULE: skills/code-review/SKILL.md:28 "P3 | Style, minor improvement, documentation | Optional".
4. No rebase onto main@7cbe7a7: the gate blocks `git rebase` while any task is on the board, and the user chose to run the merges themselves; T029 merge notes are recorded below for that merge — FACT: .claude/hooks/pre_bash_block_unsafe_merge.py:5 "Blocks git push/merge/rebase/pull commands if".
Checks: Supervisor full `npm test` 178/178 at b5fe3ef (traced under T032); implementer web 75/75, session 37/37, docs-tools 1/1, tsc clean. The one implementer-side failure (harness-snapshot) came from a hook-created untracked `.claude/skills/verify/`, removed by the Supervisor.
Memory: memory/learnings.md — "Inline images need a cap on both sides, pixel caps need the device pixel ratio, and secret masking is more than `type=password` (T032)"; memory/MEMORY.md — index line for it
Merge notes vs T029 (main@7cbe7a7): `startSession(target, timeoutMs, onIdle?, settings?)` — keep main's idle fields and this branch's `settings`; in `ui_start_session` keep main's `owned.tryReserve()`/`add` flow, drop the branch's `activeSessionId` guard, and on a `startSession` error call `owned.cancelReservation()` then return the `isError` text; register `ui_set_viewport`, `ui_type`, `ui_navigate_history` with `registerSessionTool(`; keep main's `registerSessionTool(` headers for `ui_scroll`/`ui_take_screenshot` with this branch's schema and body; union README/RUNBOOK/site tool lists and re-derive the count; add a two-session viewport test next to `test/multi-session.test.ts`.
Not done: merge into main (user runs it); rebuilt-container docs-site drive (SC 8). Independent live re-verify of b5fe3ef: PASS.
