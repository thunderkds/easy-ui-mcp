# TASK_GUIDE — T029: Multiple concurrent sessions on one MCP connection
**Date**: 2026-11-10
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `memory/codebase-map.md` if present
7. Read `BRAINSTORMING_LOG_multi-session.md` (Option A, edge cases)

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-11-10): one agent connected to easy-ui-mcp runs a test session and, **at the same time**, wants a second session open so it can compare the two (e.g. two URLs, two builds, logged-in vs logged-out). Today this is impossible:
- `src/server.ts:101` holds a single `activeSessionId` per MCP connection; a second `ui_start_session` is rejected with "A session is already active — call ui_end_session first".
- No tool takes a session id, so even with two sessions the agent could not choose which one to drive.
- An agent uses one MCP connection per configured server, so "use a second connection" is only a config workaround (register the server twice).

**Restated intent**:
> One MCP connection can hold several open sessions at once. `ui_start_session` returns a session id; every session-aware tool accepts an optional `session_id` to choose the session it acts on; each session keeps its own browser, page, step label and report. Existing callers that never pass `session_id` behave exactly as today.
> A session the agent stops using is closed automatically after an idle period, and so is every session a closed connection still owns, so forgotten sessions never keep a Chromium process alive.

User follow-up (2026-11-10): "we should have auto close the session if agent do not use to reduce the memory leak". Current state found in code:
- `src/tools/session.ts:108` sets one `SESSION_TIMEOUT_MS` (10 min) timer at **start** and never resets it, so an active session is killed at 10 min while it is still in use, and an abandoned one lives the full 10 min.
- `cleanupTimedOutSession` (`session.ts:169`) deletes the session with **no report**, so the agent's work is lost and the tool calls after that say "Unknown session".
- `transport.onclose` (`src/server.ts:589`) drops the transport but leaves its sessions open until their timer fires.
- The legacy shared browser (`src/server.ts:79`) is never closed. It is left out of scope here and recorded on the cut list.

**Out of scope**:
- Sessions shared between connections (a session stays owned by the connection that started it)
- The legacy no-session shared page (`src/server.ts:79-90`) — unchanged
- A built-in "compare" tool or a side-by-side diff report — the agent compares the two reports itself
- Android session tools
- REST `/api/run-test` (already one isolated session per call)

**Requirement Refs**:
- FR-002a: `ui_start_session` / `ui_end_session` bracket a run (this task extends it)
- FR-021 (new, added by this task): multiple concurrent sessions per connection, selected by `session_id`
- US-002, US-005

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed by the user (2026-11-10, "looks good")
- [x] Open decisions D1–D3 below answered by the user (2026-11-10: provisional answers accepted)
- [x] D4–D5 answered by the user (2026-11-10: provisional answers approved)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] FR-021 added to `PRD.md` and covered by the Acceptance Criteria

### Open decisions (user)

| # | Question | Supervisor's provisional answer |
|---|----------|--------------------------------|
| D1 | Several sessions are open and a tool is called **without** `session_id`: which session does it act on? | Error that lists the open session ids. With exactly one open session, omitting `session_id` uses it (today's behaviour). Avoids silently driving the wrong page. |
| D2 | Cap on open sessions per connection (each one is a Chromium process)? | 3 per connection, overridable by env `MAX_SESSIONS_PER_CONNECTION`. |
| D3 | `ui_end_session` without `session_id` when several are open? | Same rule as D1: error listing the ids. |
| D4 | Idle timeout length? | 10 min since the session's last tool call (reuse `SESSION_TIMEOUT_MS`, now measured as idle time). |
| D5 | What does an auto-closed session leave behind? | Its report is written with status `timed_out` and a line saying it was closed after N min idle; later calls with its id get "Session <id> was closed after N min idle". |

---

## Dependencies & Reachability

**Depends on**: none (T013, T014, T017–T019 are Done)

**Entry point**: MCP tools `ui_start_session`, `ui_end_session` and every session-aware primitive (`ui_navigate`, `ui_click`, `ui_fill`, `ui_assert`, `ui_check`, `ui_step`, `ui_wait_for`, `ui_get_page_state`, `ui_take_screenshot`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`)

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | On one connection, two `ui_start_session` calls both succeed and return distinct session ids in their text | several open sessions |
| 2 | Every session-aware tool accepts an optional `session_id: string`; given one, it acts on that session's page and logs to that session's report only | choose the session |
| 3 | Two sessions navigated to different pages: `ui_get_page_state` / `ui_assert` with each `session_id` sees its own page; actions in A never appear in B's report | own browser, page, report |
| 4 | `ui_step` label is per session: a step set in A does not label B's actions | own step label |
| 5 | Exactly one open session + no `session_id` → behaves exactly as today (all existing tests pass unchanged) | existing callers unchanged |
| 6 | Several open sessions + no `session_id` → `isError` naming the open ids (per D1/D3) | no silent wrong-page action |
| 7 | Unknown, ended, or other-connection `session_id` → `isError` "Unknown session <id>"; never acts on another connection's session | ownership |
| 8 | Opening a session beyond the cap → `isError` stating the cap (per D2) | resource bound |
| 9 | `ui_end_session` with `session_id` ends only that session and writes its report; the other stays usable | per-session lifecycle |
| 10 | Connection close / transport `onclose` ends every session it still owns and writes their reports (no orphaned Chromium) | auto close |
| 12 | Idle timeout: every tool call on a session resets its timer; a session idle for `SESSION_TIMEOUT_MS` is closed (browser + context) | auto close if unused |
| 13 | A session in steady use for longer than `SESSION_TIMEOUT_MS` is **not** closed | auto close only when unused |
| 14 | An auto-closed session writes its report (per D5) and frees its cap slot (AC 8); a later call with its id returns a clear "closed after idle" error | auto close, no lost work |
| 11 | Tool descriptions, `AGENTS.md`, `HARNESS.md`, `README.md` and the docs site explain `session_id`; the doc-drift test (T023) passes | agent guidance |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | One MCP client; start A and B; navigate A → fixture page 1, B → fixture page 2; `ui_assert` a page-1-only element with `session_id=A` and with `session_id=B` | A passes, B fails; end both → two reports, each containing only its own actions | automated MCP-client test |
| 2 | Start A and B, call `ui_click` with no `session_id` | `isError`, text lists both ids | automated test |
| 3 | Start one session, run the existing flow with no `session_id` anywhere | identical to today | existing tests |
| 4 | Two clients; client 2 passes client 1's session id | `Unknown session` | automated test |
| 5a | `SESSION_TIMEOUT_MS=500`; session A idle 800 ms; session B gets a call every 200 ms for 1.2 s | A closed with a `timed_out` report; B still usable | automated test |
| 5 | Live: rebuilt container, Claude Code drives two sessions side by side | two reports in `reports/index.html` | Stage 5 `verify` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/session.test.ts && node --import tsx --test test/web.test.ts && node --import tsx --test test/docs-tools.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T029.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T029.md`.

---

## Approach

**Brainstorming: done** — `BRAINSTORMING_LOG_multi-session.md`, Option A approved by user 2026-11-10.

**Pattern reference**: `src/tools/session.ts` — the `sessions` Map already isolates browser/context/page per session id; only the per-connection bookkeeping in `src/server.ts` is single-valued.

Option A — connection-owned set + idle callback:
- `src/server.ts`: in `buildMcpServer()` replace `activeSessionId` with `owned: Set<string>`. One `resolveSession(session_id?)` applies, in order:
  - an id given but not owned → "Unknown session"
  - an id closed after idle → the D5 message
  - no id + 0 owned → legacy shared page
  - no id + 1 owned → that session
  - no id + more than 1 owned → the D1 error listing the ids
- A `withSession(handler)` wrapper plus a shared `sessionIdShape` zod field. The wrapper resolves the session, calls `beginCall`/`endCall` and passes `{ sessionId, page }` in. Every session-aware tool uses it, and `recordAction`, `runInteraction` and `ui_step` take the resolved id.
- `src/tools/session.ts`:
  - `startSession(target, { idleMs, onIdle })`, backward compatible: REST passes no `onIdle`
  - `touchSession(id)` resets the timer
  - an in-flight `beginCall`/`endCall` count, so the timer never closes a session with a call running
  - on idle: status `timed_out`, set `endedAt`, close the browser, call `onIdle(record)`
- The server's `onIdle` writes the report (in a try/catch) and moves the id to a bounded "closed after idle" list (last 20).
- `transport.onclose` ends every owned session and writes the reports.

**Vital slice**: owned-set + `resolveSession` + optional `session_id` on every session-aware tool + AC 1–9 tests.
**Cut list**:
- Cross-connection session handoff
- Compare/diff tool or merged comparison report
- Session aliases (human names instead of UUIDs)
- Closing the legacy no-session shared browser when idle (separate follow-up if wanted)

---

## Edge Case Checklist

- [ ] A `ui_wait_for` longer than the idle limit is not killed mid-call (in-flight guard; touch at start and end)
- [ ] `onIdle` / report write throws → caught and logged; the browser is still closed; the process does not crash
- [ ] Idle fires and `ui_end_session(id)` arrives in the same tick → exactly one report and one close
- [ ] A session that is `failed` and then times out → status `timed_out`, with the failed steps and failure screenshot kept in the report
- [ ] Every registered tool, given 2 open sessions and no id, returns the D1 error (iterate the tool list)
- [ ] The cap counts only live sessions; idle-closed and ended ids free their slot
- [ ] The "closed after idle" memory per connection is bounded (last 20 ids)
- [ ] A `session_id` passed while zero sessions are open → "Unknown session", never the legacy shared page
- [ ] No session open and no `session_id` → legacy shared page, unchanged
- [ ] The REST `/api/run-test` timeout behaviour is unchanged (`api-run-test.test.ts` passes)
- [ ] `transport.onclose` on a connection with 0 sessions → no-op

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/server.ts` | owned-session set, `resolveSession`, optional `session_id` on session-aware tools, cap, cleanup on close |
| `src/tools/session.ts` | `timed_out` status, idle timer (`touchSession`, `beginCall`/`endCall`), `onIdle` option |
| `test/session.test.ts` (or new `test/multi-session.test.ts`) | AC tests through a real MCP client |
| `PRD.md` | add FR-021 |
| `AGENTS.md`, `HARNESS.md`, `README.md`, `site/index.html` | document `session_id` |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/reports/index.ts` | already renders any status string (`index.ts:216`, `:590`), so no change needed |
| `src/api/run-test.ts` | already isolated per call |
| `src/tools/web.ts` | page-level primitives are session-agnostic |

---

## Test Plan

Test-first through a real MCP client on the HTTP transport (one client for AC 1–6, 8, 9; two clients for AC 7; close the transport for AC 10). Run the existing suites unchanged to prove AC 5. Then the verification command, then the Stage 5 live check on the rebuilt container.

---

## Completion Checklist

- [x] Brainstorming log written; D1–D5 answered (done 2026-11-10)
- [x] User signed off on Option A (2026-11-10)
- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T029.md`
- [ ] Security review run (Medium risk) — session ownership: one connection must never reach another's session
- [ ] Docs updated (AC 11)
- [ ] Supervisor notified: task ready for Stage 4 review
