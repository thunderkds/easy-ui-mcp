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
| verify | N/A (pending reviewer) | Implementer ran a live MCP drive (spare ports 18773/18774, real streamable-HTTP client, 19 tools listed): 375x812 dark/fr-FR session, `ui_set_viewport` back to 1280, inline screenshots (375x812, 1280x720, 302x202 element), `ui_type` 20ms/key, password masked, container scroll to end, back/forward/reload, `ui_end_session` report header shows "375x812 · dark colour scheme · locale fr-FR". Observation only: the Stage 5 `verify` skill and the rebuilt-container docs-site drive (Success Criterion 8) are not run |
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

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
