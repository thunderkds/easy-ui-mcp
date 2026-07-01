# TASK_GUIDE — T003: Session Lifecycle + JSON/HTML Report Generation
**Date**: 2026-07-01
**Complexity Level**: C2
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
5. Apply the C2 process from the Complexity matrix in `.claude/agents/general-agent-template.md`
6. Multi-file task — skim `memory/codebase-map.md` if present, otherwise review `src/tools/web.ts` and `src/server.ts` directly

---

## Requirement (Pillar 1 — Adapt the requirement)

Add `ui_start_session(target)` and `ui_end_session()` MCP tools that bracket a test run, and a report generator that logs every primitive action between them into a JSON report plus a self-contained HTML report with embedded/linked screenshots.

**Restated intent**:
> Claude Code calls `ui_start_session(target)`, performs a sequence of primitive actions, then calls `ui_end_session()`. The server has been logging every action in between; on `ui_end_session()` it emits a JSON report and an HTML report (with screenshots) to the mounted `reports/` volume, and returns the report path(s) to the caller.

**Out of scope**:
- REST wrapper (`/api/run-test`) — T004
- Video capture — explicitly out of scope for v1 per `PRD.md`

**Requirement Refs** (from `PRD.md`):
- FR-002a: `ui_start_session`/`ui_end_session` bracket a run; all primitive actions between them logged into one report
- FR-005: JSON + HTML report generated for every session
- FR-008: reports persisted to a Docker volume-mounted `reports/` folder accessible from the host
- NFR-007: fail-fast — on a failing step, stop, capture screenshot + error context, still emit a report marked failed

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_start_session(target)` opens a fresh browser context and begins logging subsequent tool calls | FR-002a |
| 2 | Every primitive tool call (`ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`) made between start/end is recorded with timestamp, action, and result | FR-002a, FR-005 |
| 3 | `ui_end_session()` writes a JSON report and a self-contained HTML report (embedded/linked screenshots) to `reports/`, and returns their paths | FR-005, FR-008 |
| 4 | If a step fails mid-session, the session stops at that step, a screenshot + error context is captured, and the report is still emitted, marked failed | NFR-007 |
| 5 | Two sessions started concurrently do not corrupt or merge each other's report or browser context | (edge case from `BRAINSTORMING_LOG.md`) |
| 6 | A session left open with no `ui_end_session()` call does not leak indefinitely (timeout/cleanup) | (edge case from `BRAINSTORMING_LOG.md`) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | `ui_start_session` → `ui_navigate` → `ui_click` → `ui_end_session` | JSON + HTML report exist in `reports/`, listing both actions in order | automated test |
| 2 | A step fails mid-session (e.g. `ui_click` on missing selector) | Session stops, report emitted marked failed, screenshot captured at failure point | automated test |
| 3 | Two sessions started back-to-back without waiting | Each gets its own isolated browser context and report file, no cross-contamination | automated test |
| 4 | Session started, no `ui_end_session` call, time passes beyond timeout threshold | Server cleans up the browser context (verify via resource check, not a hang) | automated test with a shortened test-only timeout |

### Verification Command (exact, runnable)

```bash
npm test -- reports/session
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ✅ pass | `test/session.test.ts` — 5 new tests: happy path (AC1-3), mid-session failure (AC4), concurrent sessions (AC5), timeout cleanup (AC6), unmatched `ui_end_session` (Edge Case Checklist). All 5 pass. |
| Verification command run | ✅ pass | `npm test -- reports/session` → 23/23 pass (18 pre-existing T001/T002 tests + 5 new T003 tests). Also ran plain `npm test` → same 23/23. |
| Negative cases hold | ✅ pass | mid-session failure marks session `failed` + captures screenshot; `ui_end_session` on unknown/no session returns a clear error, not a crash; timed-out session frees browser resources without hanging. |
| `verify` skill — works in running app | ⚠️ partial | Attempted a live HTTP/MCP drive of `ui_start_session`→`ui_navigate`→`ui_end_session` against `localhost:8765`, but port 8765 is currently bound by a different worktree's Docker container (`agent-a16b02961521eb820-easy-ui-mcp-1`, running the pre-T003 `dist/server.js`) — not my code, and not mine to stop (Common-Infrastructure territory). Module-level behavior (session lifecycle, action logging, report generation, atomic writes) is fully covered by the automated `test/session.test.ts` suite instead. Recommend Common-Infrastructure rebuild/restart the container against this branch to confirm the live HTTP path before merge. |
| Review scope bounded to the change's blast radius | ✅ pass | Touched only `src/server.ts` (wiring), new `src/tools/session.ts`, new `src/reports/index.ts`, new `test/session.test.ts`. `src/tools/web.ts` untouched (logging done via a wrapper in `server.ts` instead, see Deviations). |
| Full smoke suite still green (no regression) | ✅ pass | `npm test` → 23/23 pass (all pre-existing T001/T002 tests unaffected). |
| **UI: Visual regression** | ☐ N/A | No UI — backend/tooling task |
| **UI: Design-system compliance** | ☐ N/A | No UI — backend/tooling task |
| **UI: Responsiveness** | ☐ N/A | No UI — backend/tooling task |

---

## Approach

Keep session state in-memory keyed by a session ID returned from `ui_start_session`. The HTML report should be a single self-contained file (inline base64 screenshots or relative links within the same `reports/` volume — inline is simpler and avoids broken-link risk if the folder is copied elsewhere). Match the visual style already used in `templates/thinking_report_template.html`/`templates/report_template.html` for consistency if convenient, but this is not required — a plain readable report is sufficient for v1.

---

## Edge Case Checklist

- [ ] Report generation when a screenshot file write fails (disk full, permissions) — must not crash the whole session
- [ ] Docker container restarted mid-session — in-flight session data should not corrupt the reports volume (write-on-complete or atomic rename, not incremental in-place writes to the final report file)
- [ ] `ui_end_session()` called without a matching `ui_start_session()` — clear error, not a crash

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/unified.ts` | New — `ui_start_session`/`ui_end_session` tools, session registry, action logging |
| `src/reports/` | New — JSON + HTML report generator |
| `src/server.ts` | Register session tools; wire action logging into existing primitive tool calls |
| `src/tools/web.ts` | Minor — tools log their invocation to the active session if one exists |

**Actual files changed (see Deviations below for why):**

| File | Change |
|------|--------|
| `src/tools/session.ts` | New — session registry (start/end/log/markFailed), per-session browser context + page, timeout cleanup |
| `src/reports/index.ts` | New — JSON + self-contained HTML report generator, atomic write-then-rename |
| `src/server.ts` | Registers `ui_start_session`/`ui_end_session`; existing primitive tool handlers now resolve the active session's page and log their outcome via a `recordAction` closure |
| `test/session.test.ts` | New — 5 tests covering all 4 Test Plan scenarios + the unmatched-`ui_end_session` edge case |
| `src/tools/web.ts` | **Not touched** — see Deviations |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `Dockerfile`, `docker-compose.yml` | Owned by T001; only touch if the `reports/` volume mount needs adjusting, and note that explicitly if so |
| `.claude/`, `templates/`, `memory/` | Supervisor framework scaffolding |

---

## Test Plan

Automated tests for: full session happy path, mid-session failure path, concurrent sessions, session cleanup on timeout. Manual: inspect a generated HTML report visually for readability.

---

## Deviations from the predicted approach

1. **`src/tools/session.ts` instead of `src/tools/unified.ts`** — the session registry is session-keyed (not "unified" with the primitives), so a name reflecting its actual responsibility seemed clearer. No behavior difference from what the guide describes.
2. **`src/tools/web.ts` untouched** — rather than have each primitive function log its own invocation, the logging + failure-screenshot capture is done once, in `server.ts`, via a shared `recordAction` closure that wraps every `registerTool` handler. This keeps `web.ts`'s primitives pure/transport-agnostic (as T001/T002 left them) and avoids duplicating logging logic six times.
3. **Session/browser-context boundary**: each `ui_start_session` call launches its own fresh `Browser` + `BrowserContext` + `Page`, tracked in a module-level registry keyed by a random session id (not tied to the MCP transport's `mcp-session-id`). Only one `ui_session` may be active at a time per MCP connection (a second `ui_start_session` before `ui_end_session` returns a clear error) — this satisfies AC5 (concurrent sessions started back-to-back get isolated contexts) without introducing multi-session-per-connection complexity the requirement didn't ask for.
4. **Report file naming**: `reports/session-<id>.json` / `.html`, one pair per session, matching the "reports/" volume-mount requirement (FR-008) without inventing a nested folder scheme.

## Known environment note (not a code defect)

Manually driving the live HTTP/MCP endpoint on `localhost:8765` was blocked because that port is currently owned by a **different worktree's** Docker container (`agent-a16b02961521eb820-easy-ui-mcp-1`, serving the pre-T003 `dist/server.js`). This is a container-ownership conflict between two active agent worktrees, not a T003 code issue — see the `verify` row in Evidence above. `npm run build` (`tsc`) succeeds cleanly against the new code, and the full automated suite (which exercises the real session/report/timeout code paths, not mocks) is green.

## Completion Checklist

- [x] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run — deferred to Stage 4 (Supervisor-run)
- [x] Lint passes (`tsc -p tsconfig.json` — 0 errors)
- [x] Tests written AND pass — output pasted into Evidence table (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — partially blocked by a port conflict with another worktree's container; see Evidence table and "Known environment note" above
- [ ] `memory/MEMORY.md` updated — Supervisor-only write; flagging for Supervisor: (a) per-connection browser/page state pattern for session isolation, (b) dash (`/bin/sh`) vs zsh `**` globstar mismatch in `npm test`'s glob — keep new test files flat under `test/`, not in subdirectories, or the pattern silently drops top-level test files
- [x] Supervisor notified: task ready for Stage 4 review (this report)
