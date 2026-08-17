# TASK_GUIDE — T012: Android smoke suite + end-to-end verification + docs
**Date**: 2026-07-09
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P0
**Assigned agent**: QA-Automation-Agent
**Agent guide**: `.claude/agents/qa.md`

---

## Mandatory Startup (Do Not Skip)

1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/qa.md`
5. Apply the C1 process from the Complexity matrix in `.claude/agents/general-agent-template.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

Independently verify the full Android tool set (T006–T011) works end-to-end against a real/emulated device, add a smoke test covering the whole `android_start_session → android_tap/input/swipe/assert/get_screen_state/take_screenshot → android_end_session` flow, and update `PROJECT_SPEC.md`/`README.md` to document the new `android_*` tools alongside the existing `ui_*` ones.

**Restated intent**:
> A single smoke test drives a real Android session end-to-end (all 8 android tools in sequence) against the local-emulator setup documented in T006, confirming the full v2 milestone works together — not just that each task's unit tests pass in isolation. Per the general Pillar 3 rule, this oracle is authored/signed off by the Supervisor, not by whichever agent implemented the tool being tested.

**Out of scope**: No new `android_*` tools — this task is verification and documentation only.

**Requirement Refs**: FR-010, FR-010a, FR-011, FR-012, FR-013 (verifies the full FR set added for this milestone), NFR-002 (single-command startup must still hold).

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to the Requirement Refs
- [ ] All Requirement Refs exist in `PRD.md` and are covered by the Acceptance Criteria below

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | A smoke test drives a full `android_start_session` → all 8 `android_*` actions → `android_end_session` flow against a real/emulated device from T006's setup, and passes | FR-010, FR-010a |
| 2 | The smoke test asserts a JSON + HTML report was produced for the android session, matching the v1 web-session report contract | FR-010a, FR-005 (parity) |
| 3 | `docker-compose up -d` still starts the full environment with no manual steps beyond T006's documented local-emulator setup | NFR-002 |
| 4 | `PROJECT_SPEC.md`'s Architecture Summary is updated to mention the `android_*` tool set alongside `ui_*` | Docs |
| 5 | `README.md` documents the `android_*` tools in the same format as the existing `ui_*` tool overview | Docs |
| 6 | Existing v1 web smoke tests still pass (no regression introduced across T006–T011) | Non-regression |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Emulator running per T006 guide, full smoke test run | All 8 android actions succeed, reports written | `npm test -- android-smoke.test.ts`, output pasted |
| 2 | Full test suite run (v1 + v2) | All tests green | `npm test`, output pasted |
| 3 | `docker-compose up -d --build` from clean state | Container starts, `/health` returns 200, `adb devices` shows emulator per T006 | Manual run, output pasted |

### Verification Command (exact, runnable)

```bash
npm test && docker compose up -d --build && curl -sf http://localhost:8765/health
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | [expect `test/android-smoke.test.ts`] |
| Verification command run | ☐ pass / ☐ fail | |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail | |
| Review scope bounded to the change's blast radius | ☐ pass / ☐ fail | [expect: full android tool set + docs, since this is the milestone-closing verification task] |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| UI: Visual regression | ☐ N/A | Backend/tooling project, no UI surface |
| UI: Design-system compliance | ☐ N/A | Backend/tooling project, no UI surface |
| UI: Responsiveness | ☐ N/A | Backend/tooling project, no UI surface |

> **Evidence-archiving rule applies**: the HTML report produced by the end-to-end smoke session must be copied into `reports/evidence/T012/` and committed, not left only in `reports/`'s working output.

---

## UI / Design Acceptance Criteria

Deleted — this project has no frontend UI surface (confirmed at Stage 1.5 for v1, unchanged for v2). All three UI Evidence rows above marked N/A.

---

## Approach

Write `test/android-smoke.test.ts` as an integration test exercising the real tool-registration path in `server.ts` (or as close to it as the existing `test/web.test.ts` pattern allows — follow that file's structure for consistency). Update docs last, after the smoke test proves the milestone works, so documentation reflects verified behavior rather than intent.

---

## Edge Case Checklist

- [ ] Smoke test run in an environment with no emulator available (e.g. CI without device access) — document how this is expected to be skipped/gated rather than falsely failing the whole suite.
- [ ] Smoke test flakiness from real-device timing (app launch, animation) — allow reasonable retries/timeouts, document the chosen values rather than leaving magic numbers unexplained.

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `test/android-smoke.test.ts` | New — full end-to-end android flow |
| `PROJECT_SPEC.md` | Architecture Summary update |
| `README.md` | Document `android_*` tools |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/*.ts` | This task is verification/docs only — implementation is T006–T011 |

---

## Test Plan

`test/android-smoke.test.ts` end-to-end; full `npm test` run to confirm no regression; manual `docker-compose up -d` walkthrough per NFR-002.

---

## Completion Checklist

- [ ] Implementation done (test + docs)
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Tests written AND pass — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run
- [ ] Evidence (HTML report from smoke run) copied into `reports/evidence/T012/` and committed
- [ ] `memory/MEMORY.md` updated with v2 milestone completion summary
- [ ] Supervisor notified: milestone ready for Stage 5 integration
