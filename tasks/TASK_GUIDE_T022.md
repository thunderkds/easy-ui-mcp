# TASK_GUIDE — T022: `npm test` never exits (spawned test servers outlive their tests)
**Date**: 2026-10-30
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P0
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide

---

## Requirement (Pillar 1 — Adapt the requirement)

Found by the Supervisor on 2026-10-30 while running Stage 5 for T017–T021. The user had approved those tasks for merge ("approve all"). Running `npm test` with port 8765 free gives 119/120 tests passing and 0 assertion failures, but the run never exits. `test/health.test.ts` hangs until it is killed: 2/2 of its tests pass, then the file stays open about 100–400 s. The same thing happens on unchanged `main` (`2e61df7`), so the bug is pre-existing. It blocks the merge gate, which needs one clean, completed test-runner invocation.

### Mental Model

- **Symptom:** after the last test in `test/health.test.ts` passes, the node test runner keeps the file open, and `npm test` never exits on its own.
- **Hypothesis (to confirm, not assume):** `test/health.test.ts:28` and `test/api-run-test.test.ts:29` start the server with `spawn("npx", ["tsx", "src/server.ts"])`. `server.kill("SIGTERM")` in `test.after` then signals only the `npx` wrapper. The real `node … src/server.ts` grandchild keeps running and listening on 8765, and its open stdio pipe keeps the test process alive. `api-run-test` may mask the issue by luck of ordering.
- **Fix shape (expected, confirm with diagnose):** spawn the server process directly, so the signal reaches the server: `spawn(process.execPath, ["--import", "tsx", "src/server.ts"], …)`. In `test.after`, `await` the child's `exit` (with a bounded fallback to `SIGKILL`) so that no server outlives its test file. `src/server.ts:482` already handles `SIGTERM`.

**Restated intent**:
> `npm test` runs every test file and exits by itself with a correct exit code, leaving nothing listening on port 8765.

**Out of scope**:
- Making the server port configurable (logged elsewhere; not needed for this fix)
- Any change under `src/`
- The sandbox Chromium/permission issues noted in T016

**Requirement Refs**:
- NFR-005: a future agent can extend the project (a test suite that terminates is a precondition)
- FR-007: `/health` endpoint (its test must complete)

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor, 2026-10-30. The user's "approve all" covers the merge, and this fix unblocks it.)
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Dependencies & Reachability

**Depends on**: None

**Entry point**: `npm test`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | With port 8765 free, `npm test` exits by itself with code 0 and reports 0 failures | exits by itself with a correct exit code |
| 2 | After `npm test` finishes, nothing is listening on 8765 (`ss -ltn \| grep 8765` empty) | leaving nothing listening |
| 3 | `node --import tsx --test test/health.test.ts` alone exits in well under 30 s | hang reproduced on this file |
| 4 | Same for `test/api-run-test.test.ts` alone | same spawn pattern |
| 5 | If the server ignores SIGTERM, `test.after` still terminates it (bounded SIGKILL fallback) | nothing outlives its test |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Port 8765 free, current tree | `time npm test` exits 0, `ℹ fail 0`, under ~2 min | command run, output pasted |
| 2 | Immediately after | `ss -ltn \| grep 8765` prints nothing | command run, output pasted |

### Verification Command (exact, runnable)

```bash
npm test; echo "exit=$?"; ss -ltn | grep 8765 || echo "8765 free"
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T022.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T022.md`.

---

## Approach

**Pattern reference**: `test/health.test.ts`. Keep its structure (`test.before` spawn + `waitForServer`, `test.after` teardown) and change only how the child is spawned and awaited.

**Vital slice**: the spawn call plus an awaited teardown in the two test files.
**Cut list**:
- A shared test helper module. Two call sites don't justify a new abstraction yet.
- A configurable port

Use the `diagnose` skill first: reproduce the hang, prove which process stays alive (e.g. `ps --ppid`), then fix.

---

## Edge Case Checklist

- [ ] The user's Docker container normally owns 8765. These tests need it free. Document that in the test file's header comment; do not change behaviour.
- [ ] A child that already exited before `test.after` → teardown must not hang waiting for `exit`
- [ ] Windows is irrelevant (Linux-only project)

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `test/health.test.ts` | direct spawn + awaited teardown |
| `test/api-run-test.test.ts` | same |
| `package.json` (`test` script only) | add `--test-concurrency=1`. Scope amendment authorised by the Supervisor on 2026-10-30: both files bind the hard-coded port 8765, and `node --test` runs files concurrently, so once teardown really kills servers one file's teardown can kill the server the other file is using. Sequential files fix the race without a configurable port or shared helper. |
| `test/web.test.ts` (one assertion in `getPageState caps elements at 200 ... (T018 AC6)`) | relax the wall-clock bound from `< 4000` to `< 20_000` ms, with a comment. Scope amendment authorised by the Supervisor on 2026-10-30: the bound failed at 4277 ms with machine load average ~22 (`npm test` must be reliable to exit with the correct code). The functional assertions (200 elements, `200 of 500` note) are unchanged; no retry or skip logic. |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/**` | out of scope |
| `package.json` (anything other than the `test` script's `--test-concurrency=1` flag) | the glob itself is fine |

---

## Test Plan

The test change is itself the deliverable. Reproduce the hang (BEFORE), apply the fix, and run the Verification Command (AFTER). The user's container is stopped by the Supervisor for this run, so 8765 is free. Do not start or stop Docker yourself.

---

## Completion Checklist

- [ ] Hang reproduced and root cause confirmed (diagnose)
- [ ] Fix applied; Verification Command output pasted into `tasks/TASK_REVIEW_T022.md`
- [ ] Supervisor notified: task ready for Stage 4 review
