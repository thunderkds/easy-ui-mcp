# TASK_GUIDE — T009: android_input + android_swipe primitives
**Date**: 2026-07-09
**Complexity Level**: C1
**Risk Level**: Low
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

Add `android_input` (type text into a located element, mirroring `ui_fill`) and `android_swipe` (directional or coordinate-based swipe/scroll gesture — no web analogue) to the `android_*` tool set established in T008.

**Restated intent**:
> `android_input` locates a single element and sends it text, matching `ui_fill`'s selector+value shape and error semantics. `android_swipe` performs a swipe gesture either by named direction (up/down/left/right) over the full screen, or between explicit coordinates.

**Out of scope**: `android_assert`/`android_get_screen_state` (T010), `android_take_screenshot` (T011).

**Requirement Refs**: FR-010 (`android_input`, `android_swipe` specifically).

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to FR-010
- [ ] FR-010 exists in `PRD.md` and is covered by the Acceptance Criteria below

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `android_input` accepts a locator + text value, sends text to the single matching element | FR-010 |
| 2 | `android_input` zero/multiple-match and no-active-session errors match `android_tap`'s (T008) established error semantics | FR-010, consistency |
| 3 | `android_swipe` accepts either a named direction or explicit start/end coordinates and performs the gesture | FR-010 |
| 4 | `android_swipe` with no active session → clear `isError` | FR-010 |
| 5 | Both tools log actions into the active session's report via the same path as `android_tap` | FR-010a (reuse) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session open, valid locator + text | Text entered, action logged | Automated test |
| 2 | Session open, locator matches 0/2+ elements | `isError: true`, consistent with T008 | Automated test |
| 3 | Session open, `direction: 'up'` | Swipe gesture dispatched, action logged | Automated test |
| 4 | No session open | `isError: true` for both tools | Automated test |

### Verification Command (exact, runnable)

```bash
npm test -- android.test.ts
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
| UI: Visual regression | ☐ N/A | Pure-backend task |
| UI: Design-system compliance | ☐ N/A | Pure-backend task |
| UI: Responsiveness | ☐ N/A | Pure-backend task |

---

## UI / Design Acceptance Criteria

Deleted — pure-backend task. All three UI Evidence rows above marked N/A.

---

## Approach

Extend `src/tools/android.ts` (created in T008) with `input()` and `swipe()` functions following the same shape as `android_tap`. Reuse the locator-resolution helper from T008 rather than duplicating zero/multiple-match logic.

---

## Edge Case Checklist

- [ ] `android_input` on an element that isn't focusable/editable — clear error, not silent no-op.
- [ ] `android_swipe` coordinates outside the visible screen bounds — document expected Appium behavior (native error vs wrapped).
- [ ] Swipe direction and coordinate inputs both provided — decide precedence and document it (reject as ambiguous, matching the fail-fast philosophy from T008).

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/android.ts` | Add `input`, `swipe` functions |
| `src/server.ts` | Register `android_input`, `android_swipe` tools |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts` | Locked scope |
| `src/tools/session.ts` | Session lifecycle already done in T007 |

---

## Test Plan

Extend `test/android.test.ts` with cases for `android_input` and `android_swipe` per the Success Criteria above.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run
- [ ] `memory/MEMORY.md` updated if new pattern found
- [ ] Supervisor notified: task ready for Stage 4 review
