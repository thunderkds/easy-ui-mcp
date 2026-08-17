# TASK_GUIDE — T007: Appium session lifecycle
**Date**: 2026-07-09
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P0
**Assigned agent**: Backend-Implementer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Apply the C2 process from the Complexity matrix in `.claude/agents/general-agent-template.md`
6. Read `memory/codebase-map.md` for directory layout and blast-radius hotspots (multi-file, shared-infra task)
7. Read `BRAINSTORMING_LOG_android.md` in full — this task implements Option C

---

## Requirement (Pillar 1 — Adapt the requirement)

Implement `android_start_session`/`android_end_session` MCP tools that spawn/manage the Appium server as a child process and open a WebDriver session against an external ADB-reached device, reusing the existing session-bracket/report infrastructure in `src/tools/session.ts` and `src/reports/index.ts` via a `kind: 'web' | 'android'` discriminant — per Option C in `BRAINSTORMING_LOG_android.md`.

**Restated intent**:
> Calling `android_start_session` opens exactly one Android automation bracket per MCP connection (mutually exclusive with an open `ui_*` web session, matching today's "one bracket at a time" UX), spawns/reuses an Appium server child process, connects to the target device over ADB, and logs subsequent `android_*` actions into the same report format as `ui_*` sessions today. `android_end_session` tears it down and writes the report.

**Out of scope**:
- No `android_tap`/`android_input`/etc. primitives yet (T008–T011) — this task only proves the session bracket + one no-op-safe check that the WebDriver session is alive.
- No shared `Driver` abstraction with Playwright (Option B, explicitly rejected).
- No changes to `ui_*` tool behavior or `src/tools/web.ts`.

**Requirement Refs**:
- FR-010a: `android_start_session`/`android_end_session` reusing the session/report layer.
- FR-011: MCP server spawns/manages Appium server as a child process.
- FR-012: connects to external device over ADB (host/LAN), depends on T006.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary — "session bracket," "kind discriminant" used consistently with `BRAINSTORMING_LOG_android.md`
- [ ] Every Acceptance Criterion below traces to FR-010a/FR-011/FR-012
- [ ] All Requirement Refs exist in `PRD.md` and are covered by the Acceptance Criteria below

> STOP and ask the Supervisor if the `kind` discriminant design in `session.ts` looks like it would force any change to existing `web.ts`/`ui_*` call sites — that would violate the locked Option C scope.

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `SessionRecord`/`startSession` in `src/tools/session.ts` gains a `kind: 'web' \| 'android'` discriminant; existing callers (`ui_start_session`) pass `kind: 'web'` (explicit or defaulted) with zero behavior change | FR-010a, non-regression |
| 2 | `android_start_session` capability schema resolves the apk-install-vs-preinstalled-package question from `BRAINSTORMING_LOG_android.md` Q3 — document the chosen shape (e.g. `appPackage`/`appActivity` required, `.apk` path optional for fresh install) | FR-010a |
| 3 | `android_start_session` spawns the Appium server as a child process (or reuses an already-running one) and waits for it to be ready on its HTTP port before returning success | FR-011 |
| 4 | `android_start_session` fails fast with a clear `isError` result (not a hang or crash) if the ADB target is unreachable | Edge case (from brainstorming log) |
| 5 | `android_start_session` while a `ui_*` web session is active on the same connection (and vice versa) is rejected with an error matching the existing `ui_start_session` collision message style | FR-010a, edge case |
| 6 | `android_end_session` tears down the WebDriver session, kills/releases the Appium child process cleanly, and writes JSON+HTML reports via the existing `writeReports` path | FR-010a |
| 7 | The Appium child process is killed on `SIGTERM` (server shutdown), same as the existing `browser.close()` handler | FR-011 |
| 8 | Existing `test/web.test.ts` and `test/session.test.ts` pass unmodified in behavior | Non-regression (Hard-Stop Gate 5 applies) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | AVD reachable (per T006), call `android_start_session` | Returns success, Appium process running, WebDriver session open | Automated test + manual MCP call |
| 2 | No device reachable, call `android_start_session` | Returns `isError: true` with a clear message, no hang | Automated test |
| 3 | `ui_start_session` open, then `android_start_session` called | Returns `isError: true`, collision message | Automated test |
| 4 | `android_start_session` succeeds, then `android_end_session` | Reports written to `reports/`, Appium child process no longer running (`ps` check) | Automated test + manual check |
| 5 | MCP server receives `SIGTERM` mid-Android-session | Appium child process is killed, not orphaned | Manual test (`kill -TERM`, then `ps aux \| grep appium`) |

### Verification Command (exact, runnable)

```bash
npm test -- session.test.ts android-session.test.ts
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | [expect `test/android-session.test.ts`] |
| Verification command run | ☐ pass / ☐ fail | |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail | |
| Review scope bounded to the change's blast radius | ☐ pass / ☐ fail | [expect: `session.ts`, `reports/index.ts`, new `android-session.ts`, `server.ts` tool registration] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| UI: Visual regression | ☐ N/A | Pure-backend task |
| UI: Design-system compliance | ☐ N/A | Pure-backend task |
| UI: Responsiveness | ☐ N/A | Pure-backend task |

---

## UI / Design Acceptance Criteria

Deleted — pure-backend task, no UI component. All three UI Evidence rows above marked N/A.

---

## Approach

Follow Option C from `BRAINSTORMING_LOG_android.md`: extend, don't duplicate, `session.ts`. Add `src/tools/android-session.ts` mirroring the structure of the existing `browser`/`getPage` singleton pattern in `server.ts` but for an Appium child process (spawn via Node's `child_process`, health-check its HTTP port, expose a `getAppiumClient()`/`getSessionAndroidClient(id)` accessor analogous to `getSessionPage(id)`). Register `android_start_session`/`android_end_session` tools in `server.ts` next to the existing `ui_start_session`/`ui_end_session`, reusing the single `activeSessionId` variable (not a second global) so the one-bracket-at-a-time invariant is enforced structurally, not by convention.

**Carried over from T006's Stage 4 review (P2 finding)**: `appium@2.11.4`'s `postinstall` script does **not** auto-install any driver — `appium driver list --installed` returns empty in the T006-built container. Before `android_start_session` can open a real WebDriver session, the `uiautomator2` driver must be installed, either baked into the `Dockerfile` (`RUN appium driver install uiautomator2`, alongside T006's `adb` install step) or installed lazily on first `android_start_session` call. Decide and document which; the Dockerfile approach is recommended for parity with how Playwright's browsers are already baked into the base image rather than installed at runtime.

---

## Edge Case Checklist

- [ ] ADB target unreachable at `android_start_session` time — clear `isError`, no hang.
- [ ] Appium child process fails to start (port bound, binary missing) — fail fast with underlying error, no silent fallback.
- [ ] Appium child process becomes a zombie on ungraceful shutdown — verify `SIGTERM` handler kills it; consider a startup check that kills any stale Appium process on the known port.
- [ ] `android_start_session` called while a `ui_*` session is active, and vice versa — rejected with matching error style.
- [ ] App launch succeeds at the session level but the target Activity never becomes visible — define what `markFailed`-equivalent behavior means here (deferred fully to T011, but the session layer must not crash on this case).
- [ ] Device disconnects mid-session — distinct "device lost" error on next action, not a generic timeout.

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/session.ts` | Add `kind` discriminant to `SessionRecord`/`startSession`; kind-checked accessors |
| `src/tools/android-session.ts` | New — Appium child-process lifecycle + WebDriver session management |
| `src/reports/index.ts` | Small conditional for android-kind session rendering (device serial/app package vs URL/title) |
| `src/server.ts` | Register `android_start_session`/`android_end_session` tools |
| `package.json` | (if not already done in T006) confirm Appium deps present |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts` | Zero Playwright/CSS-selector logic changes — locked in Option C |
| `src/api/run-test.ts` | REST wrapper stays web-only for this milestone |
| `test/web.test.ts` | Must stay green unmodified — behavior guard |

---

## Test Plan

New `test/android-session.test.ts` covering: successful session start/end, unreachable-device failure, collision with an active web session, and Appium child-process cleanup on `SIGTERM`. Existing `test/session.test.ts`/`test/web.test.ts` must pass unmodified.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run — feature confirmed working against a real device/emulator
- [ ] Any evidence copied into `reports/evidence/T007/` and committed
- [ ] `memory/MEMORY.md` updated (session `kind` discriminant pattern, Appium child-process lifecycle)
- [ ] Supervisor notified: task ready for Stage 4 review
