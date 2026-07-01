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

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ✅ pass | `test/session.test.ts` — 5 new tests: happy path, mid-session failure, concurrent isolated sessions, timeout cleanup, end-without-start. 23/23 total tests pass. |
| Verification command run | ✅ pass | `npm test -- reports/session` → 23/23 pass. Live MCP drive: ui_start_session → ui_navigate → ui_click (deliberate fail) → ui_end_session → real JSON+HTML report files confirmed on host filesystem with correct "failed" status and embedded failure screenshot. |
| Negative cases hold | ✅ pass | Mid-session failure correctly stops the session, marks it failed, captures screenshot, still emits report (confirmed both in tests and live). `ui_end_session` on unknown session returns clean error, not a crash. |
| verify | ✅ pass | Full live MCP session lifecycle drive against rebuilt container; JSON/HTML reports inspected directly on host, both correctly structured. 23/23 tests pass. See verification report in conversation, 2026-07-01. |
| Review scope bounded to the change's blast radius | ✅ pass | Reviewed only T003's changed files: `src/tools/session.ts`, `src/reports/index.ts`, `src/server.ts`, `test/session.test.ts` |
| Full smoke suite still green (no regression) | ✅ pass | 23/23 tests pass (18 from T001/T002 + 5 new), no regression |
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

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `Dockerfile`, `docker-compose.yml` | Owned by T001; only touch if the `reports/` volume mount needs adjusting, and note that explicitly if so |
| `.claude/`, `templates/`, `memory/` | Supervisor framework scaffolding |

---

## Test Plan

Automated tests for: full session happy path, mid-session failure path, concurrent sessions, session cleanup on timeout. Manual: inspect a generated HTML report visually for readability.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working in running app
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
