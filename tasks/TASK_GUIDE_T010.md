# TASK_GUIDE — T010: android_assert + android_get_screen_state primitives
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

Add `android_assert` (element presence/text/attribute assertion, mirroring `ui_assert`'s pass/fail model) and `android_get_screen_state` (current activity + visible element tree, mirroring `ui_get_page_state`) to the `android_*` tool set.

**Restated intent**:
> `android_assert` evaluates a locator-based condition (element present / text equals / attribute equals) against the device and returns pass/fail, logged into the session report like `ui_assert`. `android_get_screen_state` returns the current Android activity name plus a summary of visible interactive elements, giving the calling agent enough context to decide its next action — analogous to `ui_get_page_state`'s URL/title/elements.

**Out of scope**: `android_take_screenshot` (T011).

**Requirement Refs**: FR-010 (`android_assert`, `android_get_screen_state` specifically).

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to FR-010
- [ ] FR-010 exists in `PRD.md` and is covered by the Acceptance Criteria below

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `android_assert` accepts a locator + condition type (present / text-equals / attribute-equals) and returns pass/fail, mirroring `ui_assert`'s "Assertion passed"/"Assertion failed" text response | FR-010 |
| 2 | `android_assert` on an unreachable/errored evaluation (not just a false assertion) returns `isError`, distinct from a false-but-successfully-evaluated assertion (matches `ui_assert`'s ok/passed distinction) | FR-010 |
| 3 | `android_get_screen_state` returns current activity name + list of visible interactive elements (resource-id, text, class) | FR-010 |
| 4 | Both tools with no active session → clear `isError` | FR-010 |
| 5 | Both actions logged into the active session's report | FR-010a (reuse) |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session open, locator + condition true | "Assertion passed" | Automated test |
| 2 | Session open, locator + condition false | "Assertion failed" (ok, not isError) | Automated test |
| 3 | Session open, invalid locator syntax | `isError: true` | Automated test |
| 4 | Session open, `android_get_screen_state` | Returns activity name + element list | Automated test |
| 5 | No session open | `isError: true` for both tools | Automated test |

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

Extend `src/tools/android.ts` with `assertCondition()` and `getScreenState()` functions mirroring `web.ts`'s `assertCondition`/`getPageState` shapes but sourced from Appium's page-source/element APIs instead of a JS `evaluate` call in-page (native Android has no arbitrary JS execution context — `android_assert`'s condition model is necessarily locator+condition-type, not a free-form JS expression like `ui_assert`; call this distinction out explicitly in the tool's `description` field so the calling agent doesn't assume parity).

---

## Edge Case Checklist

- [ ] `android_assert` locator matches multiple elements — decide and document fail-fast vs. "any match passes" semantics (recommend fail-fast for consistency with T008).
- [ ] `android_get_screen_state` on a screen with a very large element tree — consider truncation/summarization so the response stays usable, document the limit if one is imposed.
- [ ] Assertion condition type not supported (e.g. requesting a JS-eval style condition) — clear error naming the supported condition types, not a silent misinterpretation.

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/android.ts` | Add `assertCondition`, `getScreenState` functions |
| `src/server.ts` | Register `android_assert`, `android_get_screen_state` tools |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts` | Locked scope |
| `src/tools/session.ts` | Session lifecycle already done in T007 |

---

## Test Plan

Extend `test/android.test.ts` with cases for `android_assert` and `android_get_screen_state` per the Success Criteria above.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run
- [ ] `memory/MEMORY.md` updated if new pattern found
- [ ] Supervisor notified: task ready for Stage 4 review
