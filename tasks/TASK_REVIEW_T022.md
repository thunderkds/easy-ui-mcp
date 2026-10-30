# TASK_REVIEW — T022: [Short Title]

> Sibling of `tasks/TASK_GUIDE_T022.md`. Everything here is **filled by the reviewer at Stage
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

**BEFORE** (captured 2026-10-30 07:59:51 UTC against unchanged code, port 8765 free beforehand, branch `task/T022-test-teardown` before any implementation commit):

```
$ date -u; timeout 60 node --import tsx --test test/health.test.ts; echo exit=$?
Fri Oct 30 07:59:51 AM UTC 2026
✔ GET /health returns 200 with a readiness payload (822.454285ms)
✔ MCP initialize handshake succeeds and advertises ui_navigate (37.67848ms)

Interrupted while running:

⚠ test/health.test.ts (test/health.test.ts:1:1)
✖ test/health.test.ts (59978.488377ms)
ℹ tests 3
ℹ pass 2
ℹ fail 0
ℹ cancelled 1
ℹ duration_ms 59982.730679
  'Promise resolution is still pending but the event loop has already resolved'
exit=124
```

Both tests pass, then the file never finishes; only `timeout` ends it (exit 124). An earlier identical run (07:58:43 UTC) gave the same result.

Process evidence sampled 20 s into the run (all tests had already passed), `ss -ltnp | grep 8765` and `ps`:

```
LISTEN 0 511 *:8765 *:* users:(("node-MainThread",pid=491490,fd=23))

PID     PPID    ARGS
491448  491447  node --import tsx --test test/health.test.ts            (test runner)
491454  491448  node ... --import tsx test/health.test.ts               (the test file process, still alive)
491479  2022    node .../node_modules/.bin/tsx src/server.ts            (tsx wrapper, ORPHANED: ppid 2022, not the test process)
491490  491479  node --require .../tsx/preflight.cjs --import .../tsx/loader.mjs src/server.ts   (real server, the 8765 listener)
```

The `npx` wrapper that the test spawned is already gone, and its `tsx` child and the real server grandchild survive it. So `server.kill("SIGTERM")` hit only the `npx` process, and the server kept listening on 8765.

**AFTER**: [same command, post-change] OR [verbatim excerpt of the new content]

**DELTA**: [one sentence — what a user can now do that they could not before]

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
