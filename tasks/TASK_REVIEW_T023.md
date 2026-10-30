# TASK_REVIEW — T023: [Short Title]

> Sibling of `tasks/TASK_GUIDE_T023.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/docs-tools.test.ts` (AC 7; red before, green after, output in Demonstration). AC 1-6 are doc content, checked by diff review |
| Verification command run | ☑ pass | `node --import tsx --test test/docs-tools.test.ts` pass 1 fail 0; `npx tsc --noEmit` exit 0. Full `npm test` NOT run by implementer (port 8765 owned by container) |
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

**BEFORE**: (executable change: new test run against the CURRENT, unedited docs)

```
$ date -u; node --import tsx --test test/docs-tools.test.ts
Fri Oct 30 08:42:53 AM UTC 2026
✖ README and RUNBOOK name every registered tool, and RUNBOOK states the count (11.201095ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
  AssertionError [ERR_ASSERTION]: RUNBOOK.md does not mention `ui_select_option`
      at TestContext.<anonymous> (test/docs-tools.test.ts:34:14)
```

Prior `RUNBOOK.md` line 48 (verbatim):

> | MCP tool discovery | `tools/list` JSON-RPC call to `/mcp` | Response lists all 11 tools (`ui_start_session`, `ui_end_session`, `ui_step`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_get_page_state`, `ui_take_screenshot`) |

Prior `RUNBOOK.md` line 61 (verbatim):

> | `npm test` appears to hang indefinitely | Sandbox-specific `node:test` multi-file process-isolation quirk, not a code bug (see `memory/learnings.md`) | Kill the process, verify the live endpoint directly via `curl`, then run test files individually: `node --import tsx --test test/<file>.test.ts` |

**AFTER**:

```
$ date -u; node --import tsx --test test/docs-tools.test.ts
Fri Oct 30 08:43:55 AM UTC 2026
✔ README and RUNBOOK name every registered tool, and RUNBOOK states the count (2.7321ms)
ℹ pass 1
ℹ fail 0
$ npx tsc --noEmit    # exit 0
```

New `RUNBOOK.md` line 48: "Response lists all 16 tools (`ui_start_session`, ... `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_assert`, ...)".
New `RUNBOOK.md` line 61: "`npm test` appears to hang or fails with `EADDRINUSE` | Port 8765 is held (usually by the running Docker container) ... | `docker compose stop`, run `npm test`, then `docker compose up -d`."

**DELTA**: The docs now describe all 16 tools, the real `npm test` port-8765 cause, selectors/messages and readable report names, and a test fails if README or RUNBOOK drift from the tools registered in `src/server.ts`.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
