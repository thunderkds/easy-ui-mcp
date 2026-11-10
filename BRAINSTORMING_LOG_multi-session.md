# BRAINSTORMING_LOG — multi-session
**Generated**: 2026-11-10
**Task / Context**: T029 — several concurrent sessions on one MCP connection + idle auto-close (`tasks/TASK_GUIDE_T029.md`)
**Skill**: `Skill({ skill: "brainstorming" })`
**Tier**: Standard. The problem is bounded and D1–D5 are already answered by the user, but there are real structural choices about where ownership and idle-close live.

---

## The Problem Space

One agent has one MCP connection. Today that connection can drive only one session (`activeSessionId`, `src/server.ts:101`), so the agent cannot keep two pages open and compare them. Separately, the auto-close is a fixed 10-min timer set at start (`src/tools/session.ts:108`). It kills busy sessions, keeps abandoned ones the full 10 min, drops the report (`cleanupTimedOutSession`, `session.ts:169`), and ignores closed connections (`transport.onclose`, `server.ts:589`).

Non-negotiable:
- A caller that never passes `session_id` with one session open sees no change (AC 5).
- One connection never reaches another connection's session (AC 7).
- No lost work: an auto-closed session still writes its report (D5).

Settled by the user (2026-11-10):
- **D1/D3**: no `session_id` with several sessions open → error listing the ids.
- **D2**: cap of 3 per connection, env `MAX_SESSIONS_PER_CONNECTION`.
- **D4**: idle limit is 10 min since the last call (`SESSION_TIMEOUT_MS`).
- **D5**: a report with status `timed_out`.

### Verified facts (claim gate)

| Claim | Evidence |
|-------|----------|
| The `sessions` Map already gives each session its own browser/context/page | `session.ts:91`, `startSession` `session.ts:99-127` |
| Only server-side bookkeeping is single-valued | `activeSessionId` used by `resolvePageForWrite/Read` (`server.ts:104-118`), `recordAction` (`server.ts:137-151`), `ui_start_session`/`ui_end_session` (`server.ts:186-215`), `ui_step` (`server.ts:461-471`) |
| `session.ts` does not import the report writer; only `server.ts` does | `server.ts:44`; `reports/index.ts:7` imports **types** from `session.ts` |
| `SessionStatus` is `"running" \| "passed" \| "failed"` | `session.ts:55` |
| Report renderer already shows any status string | `reports/index.ts:216` and `:590` fall back to `escapeHtml(status)`; the index strip (`:249-250`) counts only passed/failed, so a `timed_out` run counts in neither, which is acceptable |
| The REST path uses `startSession`/`endSession` directly | `src/api/run-test.ts:52,96` |
| `ui_wait_for` can block for `timeoutMs` inside one call | `server.ts:507-522` |

---

## Questions for the User

None open. D1–D5 cover the choices that change behaviour. The internal choice between the paths below is the Supervisor's to make, and the user signs it off under User Selection.

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | Connection-owned set + idle callback | `server.ts` keeps a per-connection `Set` of owned ids and one `resolveSession()`; `session.ts` gets a resettable idle timer, an in-flight guard and an `onIdle` callback that the server uses to write the report | Medium | ~150 src + ~200 test | Low–Med | ✅ Yes |
| B | Session registry owns everything | Move the owner id, idle close and report writing into `session.ts` (`startSession(target, { owner })`, `session.ts` imports `writeReports`) | Medium–High | ~200 src | Medium | |
| C | Global ids, no ownership | Add `session_id` that looks up the global Map directly; reset the existing timer on each lookup; leave auto-close without a report | Low | ~70 src | Med (fails AC 7, AC 14) | |

### Option A — Connection-owned set + idle callback
**Approach**:
- In `buildMcpServer()`, replace `activeSessionId` with `owned = new Set<string>()`.
- One `resolveSession(session_id?)` applies, in order:
  - an id that is given but not owned → "Unknown session"
  - an owned id closed after idle → the D5 message
  - no id with 0 owned → legacy shared page, unchanged
  - no id with 1 owned → that session
  - no id with more than 1 owned → error listing the ids (D1)
- Every tool spreads one shared zod field (`...sessionIdShape`) and calls `resolveSession` first. `recordAction`, `runInteraction` and `ui_step` take the resolved id rather than reading a closure variable.
- `session.ts` changes:
  - `startSession(target, { idleMs, onIdle })`
  - `touchSession(id)` resets the timer
  - `beginCall`/`endCall` keep an in-flight count, and the timer never closes a session with a call in flight
  - on idle: status `timed_out`, `endedAt`, close the browser, then `onIdle(record)`
- The server's `onIdle` writes the report and moves the id from `owned` into a small "closed after idle" set for the D5 error.
- `transport.onclose` ends every owned id and writes the reports.
- The REST path keeps its current behaviour by passing no `onIdle`.

**Pros**:
- Matches the current layering (server owns connections, session.ts owns browsers, reports stay a leaf).
- The single resolver makes D1/AC 7 impossible to bypass per tool.
- The REST path is untouched.

**Cons**: about 15 tool handlers change signature, so it's mechanical but wide in `server.ts`.

**Why it might fail**:
- A handler that forgets `resolveSession` silently uses the wrong session. Mitigation: a test that iterates every registered tool name and asserts that with 2 sessions open and no id it returns the D1 error.
- `onIdle` throwing inside a timer crashes the process. It must be wrapped in try/catch.

**50% less code**: one shared `sessionIdShape` + `withSession(handler)` wrapper instead of editing each handler body: the wrapper resolves, does `beginCall`/`endCall`, and passes `{ sessionId, page }` in. Most of the ~15 handlers then change by one line.

### Option B — Session registry owns everything
**Approach**:
- `session.ts` stores `ownerId` per session and exposes `resolveFor(owner, id?)`.
- It writes the report itself on idle, which means a runtime import of `writeReports`.
- The server just passes the transport's session id.

**Pros**: one place holds every session rule, and the server shrinks.

**Cons**:
- It adds a runtime dependency `session.ts` → `reports/index.ts`, while `reports` already depends (type-only) on `session.ts`. That tangles the leaf module.
- It changes the `startSession` signature the REST path and `test/session.test.ts` rely on.
- It moves connection knowledge into the browser layer.

**Why it might fail**: the REST path gets ownership semantics it doesn't need, and the bigger diff in the most-tested module raises regression risk for T013/T014 behaviour (screenshot budget, step labels).

### Option C — Global ids, no ownership
**Approach**: `session_id` looks up `sessions` directly. Each lookup calls `clearTimeout`/`setTimeout` on the existing handle. The timeout behaviour stays "close, no report".

**Pros**: the smallest diff, and fast.

**Cons**:
- It fails AC 7: any connection holding a UUID can drive another's browser.
- It fails AC 14/D5, so work is lost on idle.
- It does nothing for closed connections (AC 10).

**Why it might fail**: it ships the leak half-fixed and opens a cross-connection access path, the exact thing the Medium-risk security review would block.

---

## Recommended Path

**Option A** with the `withSession` wrapper from its 50%-less note. It keeps today's layering (server = connections, `session.ts` = browsers, `reports` = leaf), makes the D1 and ownership rules impossible to skip per tool, and leaves REST untouched.

---

## Surgical Scope

Files that **should** be touched:
- `src/server.ts` — owned set, `resolveSession`, `withSession`, shared `sessionIdShape`, cap, `onIdle` report write, cleanup in `transport.onclose`
- `src/tools/session.ts` — `timed_out` status, idle timer (`touchSession`, `beginCall`/`endCall`), `onIdle` option; the default stays backward compatible for REST
- `test/session.test.ts` and a new `test/multi-session.test.ts` — unit tests for the idle timer, plus MCP-client tests for AC 1–14
- `PRD.md` (FR-021), `AGENTS.md`, `HARNESS.md`, `README.md`, `site/index.html` — docs (AC 11)

Files that **must not** be touched:
- `src/reports/index.ts` — already renders any status string (verified)
- `src/api/run-test.ts` — keeps the current `startSession` call shape
- `src/tools/web.ts` — page primitives are session-agnostic

---

## Edge Case Checklist for TASK_GUIDE

- [ ] A `ui_wait_for` longer than the idle limit is not killed mid-call (in-flight guard; touch at start and end)
- [ ] `onIdle` / report write throws → caught and logged; the browser is still closed; the process does not crash
- [ ] Idle fires and `ui_end_session(id)` arrives in the same tick → exactly one report and one close (`sessions.delete` first wins; the other path sees "already closed")
- [ ] A session that is `failed` and then times out → status `timed_out`, with the failure screenshot and failed steps still in the report (a status change only)
- [ ] Every registered tool, given 2 open sessions and no id, returns the D1 error (iterate the tool list, don't hand-pick)
- [ ] The cap counts only live sessions; idle-closed and ended ids free their slot
- [ ] The "closed after idle" memory per connection is bounded (keep the last N ids, e.g. 20)
- [ ] The REST `/api/run-test` timeout behaviour is unchanged (existing `api-run-test.test.ts` passes)
- [ ] `transport.onclose` on a connection with 0 sessions → no-op

---

## Next Actions

1. Copy the recommended approach and the edge-case checklist above into `tasks/TASK_GUIDE_T029.md` (replace "Brainstorming: PENDING").
2. Drop `src/reports/index.ts` from the guide's predicted changes; it is already verified safe.
3. After the user signs off on the path, spawn `backend-developer` on T029 (test-first, `tdd`).
4. Stage 4: run `code-review` and `security-review`, focusing on session ownership and the timer/report race.

---

## User Selection

> **Approved direction**: Option A — Connection-owned set + idle callback (approved)
> Approved by user on 2026-11-10
