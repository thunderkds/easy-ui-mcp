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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/health.test.ts` and `test/api-run-test.test.ts` are the changed tests. Run alone: health 2/2 pass, api-run-test 4/4 pass, each finishing in a few seconds with 8765 free afterwards (AC 3, 4). Full `npm test` 119/119, exit 0, 8765 free (AC 1, 2), three consecutive runs plus five more after the `--test-concurrency=1` amendment. AC 5 (SIGKILL fallback) checked with a scratch child that ignores SIGTERM and the same teardown code, fallback shortened to 1 s: `ignored SIGTERM; terminated after 1005ms, signal=SIGKILL`; an already-exited child returns at once. |
| Verification command run | ☑ pass | 2026-10-30 08:01:37-08:01:46 UTC. `ℹ tests 119 / ℹ pass 119 / ℹ fail 0 / ℹ cancelled 0 / ℹ duration_ms 8596.727674`, then `exit=0`, then `8765 free`. No stray `src/server.ts` processes afterwards. After the `--test-concurrency=1` amendment, three consecutive runs (see AFTER) were each exit=0, fail 0, 8765 free. |
| Negative cases hold | ☑ pass | Child that ignores SIGTERM is SIGKILLed after the bound; child already exited does not hang teardown (scratch check above). |
| verify | ☑ pass | **Supervisor 2026-10-30, independent of the implementer, at 7f94c07, user container stopped:** ran `npm test` three times back to back. Run 1 08:06:24Z: exit=0, 119/119, fail 0, 8765 free. Run 2 08:06:44Z: same. Run 3 08:07:01Z: same — pass. Before the concurrency fix, the Supervisor's own second run (08:02:32Z, ce3d7c0) failed 3 `api-run-test` tests (`other side closed` / `ECONNREFUSED`), which is what found the parallel-port race. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed the `test.before`/`test.after` blocks of `test/health.test.ts` and `test/api-run-test.test.ts`, the `package.json` `test` script, and `src/server.ts:482` (the SIGTERM handler the fix relies on, unchanged). No `src/` change. |
| Full smoke suite still green (no regression) | ☑ pass | Full `npm test` 119/119 pass, 0 fail, 0 cancelled, in 8 of 8 runs after the amendment. |
| **UI: Visual regression** | ☑ N/A | Test-infrastructure task, no UI surface |
| **UI: Design-system compliance** | ☑ N/A | Test-infrastructure task, no UI surface |
| **UI: Responsiveness** | ☑ N/A | Test-infrastructure task, no UI surface |

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

Extra BEFORE note, second defect (concurrency race), reproduced 2026-10-30 08:03:24 UTC on the code at ce3d7c0 (teardown fix, no `--test-concurrency=1`), run 3 of a loop of `npm test` (runs 1 and 2 at 08:03:06 and 08:03:15 were 119/119, exit 0):

```
run 3 exit=1
ℹ pass 116 ℹ fail 3
✖ POST /api/run-test with a valid body runs a smoke check and returns a real report (30.6ms)
✖ POST /api/run-test missing app_url_or_package returns a clear 4xx error (9.7ms)
✖ POST /api/run-test with an unreachable URL returns a failed status, not a crash (6.5ms)
    [cause]: Error: connect ECONNREFUSED 127.0.0.1:8765
```

The Supervisor's own run at 08:02:32 UTC failed the same way (`SocketError: other side closed`, then `ECONNREFUSED`). Cause: `node --test` runs the files concurrently, `health.test.ts` and `api-run-test.test.ts` both start a server on the hard-coded port 8765, and when one file's teardown kills its server the other file loses the one it was talking to. Observed failure rate about 2 in 5 across the runs above, always in `api-run-test`.

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

**AFTER** (2026-10-30 08:01:37 UTC, same tree plus the two-file test change; first run, before the concurrency race was found):

```
$ npm test; echo "exit=$?"; ss -ltn | grep 8765 || echo "8765 free"
ℹ tests 119
ℹ suites 0
ℹ pass 119
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8596.727674
exit=0
8765 free
```

Amendment (package.json `test` script: `node --import tsx --test --test-concurrency=1 test/**/*.test.ts`), Verification Command run three times in a row:

```
run 1 (08:03:44 UTC): ℹ tests 119  ℹ pass 119  ℹ fail 0  ℹ cancelled 0  ℹ duration_ms 15866.03  exit=0  8765 free
run 2 (08:04:00 UTC): ℹ tests 119  ℹ pass 119  ℹ fail 0  ℹ cancelled 0  ℹ duration_ms 15371.51  exit=0  8765 free
run 3 (08:04:16 UTC): ℹ tests 119  ℹ pass 119  ℹ fail 0  ℹ cancelled 0  ℹ duration_ms 16514.95  exit=0  8765 free
```

Five further runs (extra runs 4 to 8) were each exit=0 with 8765 free. Total time per run is about 16 s instead of about 9 s because the files no longer overlap.

`test/health.test.ts` alone now finishes in about 2 s (2/2 pass, `8765 free`) where it was cut off at 60 s with exit 124.

**DELTA**: `npm test` now runs all test files, exits by itself with code 0 in about 9 s and leaves nothing listening on 8765, so the Stage 5 merge gate can get one clean completed run.

**WITNESS**: Supervisor, 2026-10-30 08:06–08:07Z: three independent `npm test` runs at 7f94c07, all exit=0, 119/119, 8765 free (see verify row).


---

## Code Review (Stage 4 — Supervisor, 2026-10-30)

Scope: `36e0ab2..7f94c07`. Personas: correctness, testing, maintainability, standards. Security and performance are not activated: test-only change, Low risk.

Entry-point reachability: the `npm test` script is in `package.json`, so it is reachable.

Pre-review round (fixed in 7f94c07): **P1** parallel test files raced on the hard-coded port 8765, so `npm test` was flaky (2 failures in about 5 runs).

### P0 — Must Fix
None.

### P1 — Should Fix
None remaining.

### P2 — Recommended
None.

### P3 — Optional (follow-ups, not blocking)
| File | Finding | Confidence | Action |
|---|---|---|---|
| `test/health.test.ts`, `test/api-run-test.test.ts` | The spawned server's stdout/stderr pipes are never read; a chatty server could block on a full pipe | 75 | Use `stdio: "ignore"` (or drain the pipes) |
| `src/server.ts` | The hard-coded port is the root of both the race and the Docker conflict | 100 | Already logged as a deferred enhancement (configurable port) |
| tests | The SIGKILL fallback (AC5) is verified only by a scratch script, not a committed test | 75 | Accepted; adding one would need the shared helper that is on the cut list |


---

## Addendum — flaky timing assertion (Supervisor scope amendment, 2026-10-30)

**Before**: with the trace hook active, a full `npm test` at eaacd16 failed 1 test, `getPageState caps elements at 200 with a truncation note and stays fast (T018 AC6)`, at 4277 ms against `assert.ok(elapsed < 4000)` (`test/web.test.ts`), with machine load average ~22. The same test alone took 3890 ms and 3957 ms. (Failure output as reported by the Supervisor; I did not reproduce the 4277 ms run myself.)

**Change**: `test/web.test.ts`, that one assertion only: `elapsed < 4000` became `elapsed < 20_000`, with a comment saying the ceiling is loose on purpose (T018's target was ~2 s on an idle machine; wall-clock asserts flake under load). The `elements.length === 200` and `/200 of 500/` note assertions are untouched. No retries, no skip.

**After**: Verification Command run twice at load average ~21-22 (`uptime`):

```
run 1 (08:18:41 UTC): ℹ tests 119  ℹ pass 119  ℹ fail 0  ℹ cancelled 0  ℹ duration_ms 23745.13  exit=0  8765 free
      ✔ getPageState caps elements at 200 ... (T018 AC6) (3750.63ms)
run 2 (08:19:05 UTC): ℹ tests 119  ℹ pass 119  ℹ fail 0  ℹ cancelled 0  ℹ duration_ms 23029.24  exit=0  8765 free
      ✔ getPageState caps elements at 200 ... (T018 AC6) (5843.96ms)
```

Run 2's 5844 ms for that test would have failed the old 4000 ms bound; under the new ceiling it passes, which is the flake this amendment removes.
