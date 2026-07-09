# TASK_GUIDE — T011: android_take_screenshot + android failure-capture story
**Date**: 2026-07-09
**Complexity Level**: C1
**Risk Level**: Medium
**Priority**: P1
**Assigned agent**: Backend-Implementer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Apply the C1 process from the Complexity matrix in `.claude/agents/general-agent-template.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

Add `android_take_screenshot` (mirroring `ui_take_screenshot`) and define the android-session equivalent of `markFailed`'s screenshot-on-failure behavior, explicitly handling the case flagged in `BRAINSTORMING_LOG_android.md` where a failure occurs before the app ever renders any UI (no screenshot is meaningful).

**Restated intent**:
> `android_take_screenshot` captures the current device screen and saves it as PNG to the reports output, matching `ui_take_screenshot`'s response shape. On a failed `android_*` action, the session/report layer attempts best-effort evidence capture (screenshot if a UI is rendered; otherwise a clear textual note that no visual evidence was available, rather than a silent gap or a crash).

**Out of scope**: This task does not change T007's core session lifecycle — it only adds the screenshot tool and wires a failure-capture callback into the existing `markFailed`-equivalent path for android sessions.

**Requirement Refs**: FR-010 (`android_take_screenshot`); Edge Case Checklist item from `BRAINSTORMING_LOG_android.md` ("no screenshot equivalent for a not-yet-launched app").

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to FR-010 or the named edge case
- [ ] FR-010 exists in `PRD.md` and is covered by the Acceptance Criteria below

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `android_take_screenshot` captures the device screen and saves PNG to `REPORTS_DIR`, returning the path | FR-010 |
| 2 | `android_take_screenshot` with no active session → clear `isError` | FR-010 |
| 3 | On a failed `android_*` action where the device/app has a renderable UI, a screenshot is captured and attached the same way `markFailed` does for web sessions today | Edge case |
| 4 | On a failed `android_*` action where no UI was ever rendered (e.g. app launch failure before any Activity is visible), the failure record contains an explicit textual note ("no visual evidence available — app did not render before failure") instead of a missing/broken screenshot path | Edge case (explicitly called out in brainstorming) |
| 5 | This failure-capture logic does not alter `markFailed`'s existing web-session behavior | Non-regression |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session open, call `android_take_screenshot` | PNG saved, path returned | Automated test |
| 2 | No session open | `isError: true` | Automated test |
| 3 | Simulated action failure with app UI rendered | Screenshot captured in failure record | Automated test (mocked or real device) |
| 4 | Simulated action failure with no UI rendered | Textual "no visual evidence" note, no broken path | Automated test |
| 5 | Existing web `markFailed` tests | Unchanged behavior | `npm test -- session.test.ts` still green |

### Verification Command (exact, runnable)

```bash
npm test -- android.test.ts session.test.ts
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | |
| Verification command run | ☐ pass / ☐ fail | |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail | |
| Review scope bounded to the change's blast radius | ☐ pass / ☐ fail | |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| UI: Visual regression | ☐ N/A | Backend task; screenshot correctness verified via automated test, not visual-regression tooling |
| UI: Design-system compliance | ☐ N/A | No design system involved — screenshots of device under test |
| UI: Responsiveness | ☐ N/A | Not applicable to this backend tool |

---

## UI / Design Acceptance Criteria

Deleted — this task produces screenshots as evidence artifacts, not a UI surface of the project itself. All three UI Evidence rows above marked N/A.

---

## Approach

Add `takeScreenshot`-equivalent to `src/tools/android.ts` using Appium's screenshot API. Extend the `markFailed`-equivalent hook in `src/tools/android-session.ts` (from T007) to attempt a screenshot, catching and falling back to a textual note if the screenshot call itself fails (which is the signal that no UI was rendered) rather than trying to detect "no UI rendered" as a separate pre-check.

---

## Edge Case Checklist

- [ ] Screenshot capture itself times out or errors (not just "no UI") — must not crash the failure-handling path; falls back to the same textual note.
- [ ] Very large/high-resolution device screenshots — confirm no unbounded memory/size issue before committing to `reports/`.
- [ ] Screenshot taken mid-animation/transition — acceptable as best-effort, document as a known limitation rather than trying to solve it.

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/android.ts` | Add `takeScreenshot` function |
| `src/tools/android-session.ts` | Extend failure-capture hook with screenshot-or-note fallback |
| `src/server.ts` | Register `android_take_screenshot` tool |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts` | Locked scope |
| `src/tools/session.ts` markFailed (web path) | Web failure-capture behavior must not change |

---

## Test Plan

Extend `test/android.test.ts` with `android_take_screenshot` cases, and add failure-capture cases (UI rendered vs. not) to `test/android-session.test.ts` (from T007) or a new dedicated test file.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (Medium risk)
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run
- [ ] Any evidence copied into `reports/evidence/T011/` and committed
- [ ] `memory/MEMORY.md` updated if new pattern found
- [ ] Supervisor notified: task ready for Stage 4 review
