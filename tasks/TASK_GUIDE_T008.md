# TASK_GUIDE — T008: android_tap primitive + report wiring (tracer bullet)
**Date**: 2026-07-09
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P0
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

Implement `android_tap`, the first real Android interaction primitive, proving the T007 session pipe end-to-end — mirroring `ui_click`'s pattern but using Appium locator strategies (resource-id / accessibility id / xpath / uiautomator) instead of CSS selectors.

**Restated intent**:
> With an `android_start_session` bracket open (T007), `android_tap` locates and taps a single element on the device, logs the action into the session's report the same way `ui_click` does today, and fails clearly (not silently) if zero or multiple elements match.

**Out of scope**: `android_input`/`android_swipe` (T009), `android_assert`/`android_get_screen_state` (T010), `android_take_screenshot` (T011).

**Requirement Refs**: FR-010 (android_tap specifically).

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to FR-010
- [ ] FR-010 exists in `PRD.md` and is covered by the Acceptance Criteria below

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `android_tap` accepts a locator (strategy + value, e.g. `{strategy: 'resource-id', value: '...'}`) and taps the single matching element | FR-010 |
| 2 | Zero matches → clear `isError` result, matching `ui_click`'s "single element" failure semantics | FR-010, edge case |
| 3 | Multiple matches → clear `isError` result stating ambiguity (fail-fast, per Edge Case Checklist decision) | FR-010, edge case |
| 4 | No active android session → clear `isError` ("call android_start_session first"), matching `ui_click`'s no-active-page pattern | FR-010 |
| 5 | Successful tap is logged into the active session's report via the existing `recordAction`-equivalent path | FR-010a (reuse) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session open, valid resource-id matching one element | Tap succeeds, action logged | Automated test against a test app, or Appium mock |
| 2 | Session open, resource-id matching zero elements | `isError: true`, clear message | Automated test |
| 3 | Session open, resource-id matching 2+ elements | `isError: true`, ambiguity message | Automated test |
| 4 | No session open | `isError: true`, "no active session" message | Automated test |

### Verification Command (exact, runnable)

```bash
npm test -- android.test.ts
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | [expect `test/android.test.ts`] |
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

New `src/tools/android.ts` mirroring `src/tools/web.ts`'s `click()` function shape but operating on the Appium WebDriver client (from `getSessionAndroidClient(id)` added in T007) instead of a Playwright `Page`. Register `android_tap` in `server.ts` next to the `ui_*` tools, following the same `resolvePageForRead`-equivalent pattern for resolving the active android session.

---

## Edge Case Checklist

- [ ] Locator matches zero elements — fail fast, not silent no-op.
- [ ] Locator matches multiple elements — fail fast with ambiguity error (decision locked here, applies to future android tools too).
- [ ] Tap on an element that's present in the accessibility tree but not currently visible/enabled — document expected behavior (Appium's native error vs. a wrapped message).

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/android.ts` | New — `android_tap` primitive |
| `src/server.ts` | Register `android_tap` tool |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts` | Locked scope — v1 web tools untouched |
| `src/tools/session.ts` | Session lifecycle already done in T007 — don't re-touch unless a genuine gap is found (ask Supervisor first) |

---

## Test Plan

New `test/android.test.ts` covering the 4 Success Criteria above, against an Appium mock or a real test app per T006's local-emulator setup.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run
- [ ] `memory/MEMORY.md` updated if new pattern found
- [ ] Supervisor notified: task ready for Stage 4 review
