# PROJECT_KANBAN.md
**Last updated**: 2026-08-17

> Compact task board. Full context lives in `PROJECT_SPEC.md`. Update this file whenever a task status changes.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo
- [ ] **T008** — android_tap primitive + report wiring (tracer bullet) | backend-developer | C1 | Risk: Low | P0 | Blocked by: T007
- [ ] **T009** — android_input + android_swipe primitives | backend-developer | C1 | Risk: Low | P1 | Blocked by: T007
- [ ] **T010** — android_assert + android_get_screen_state primitives | backend-developer | C1 | Risk: Low | P1 | Blocked by: T007
- [ ] **T011** — android_take_screenshot + android failure-capture story | backend-developer | C1 | Risk: Medium | P1 | Blocked by: T007
- [ ] **T012** — Android smoke suite + end-to-end verification + docs | qa-expert | C1 | Risk: Low | P0 | Blocked by: T008, T009, T010, T011
- [ ] **T014** — Human-readable reports: `ui_step` + grouped renderer + durations + console/network capture | backend-developer | C2 | Risk: Low | P1 | Blocked by: T013 | Go/no-go gated on reviewing T013's output

### In Progress

### Ready for Review
- [ ] **T007** — Appium session lifecycle: android_start_session/android_end_session + session.ts kind discriminant | backend-developer | C2 | Risk: Medium | P0 | Blocked by: None (T006 done)
- [ ] **T013** — Truthful verdicts: `ui_check` + `ui_wait_for` + screenshot dedupe/budget | backend-developer | C2 | Risk: Medium | P0 | Implemented 2026-08-17; 19/19 tests, live drive passed both soft and hard paths. Note for T007: `session.ts` gained `soft` on `LoggedAction` + 2 record fields — merge with the `kind` discriminant carefully


### Done
- [x] **T001** — Docker + MCP server skeleton + ui_navigate tracer bullet | C2 | Completed: 2026-07-01
- [x] **T002** — Remaining primitive Playwright tools | C1 | Completed: 2026-07-01
- [x] **T003** — Session lifecycle + JSON/HTML report generation | C2 | Completed: 2026-07-01
- [x] **T004** — REST API wrapper (/api/run-test) + /health | C1 | Completed: 2026-07-01
- [x] **T005** — AGENTS.md / HARNESS.md documentation | C0 | Completed: 2026-07-01
- [x] **T006** — Docker/infra: bundle adb, Appium deps, local-emulator connection guide | common-infrastructure | C1 | Completed: 2026-07-09

---

## Blocked

None.

---

## Stage Tracker

| Stage | Status |
|-------|--------|
| 0.5 Brainstorming | ✅ Done |
| 1 Environment Setup | ✅ Done |
| 1.5 Sub-Agent Architecture | ✅ Done |
| 2 Planning (/plan) | ✅ Done |
| 3 Execution | ✅ Done |
| 4 Review | ✅ Done |
| 5 Integration & Verify | ✅ Done |

---

## Milestone: v2 — Android (Appium)

| Stage | Status |
|-------|--------|
| 0.5 Brainstorming | ✅ Done — `BRAINSTORMING_LOG_android.md`, Option C approved |
| 1 Environment Setup | ✅ Done (reuses v1 setup) |
| 1.5 Sub-Agent Architecture | ✅ Done (reuses v1 team) |
| 2 Planning (/plan) | ✅ Done — T006–T012 generated |
| 3 Execution | 🔄 In progress — T006 done, T007 next |
| 4 Review | 🔄 T006 reviewed (0 P0/P1, 1 P2 carried into T007) |
| 5 Integration & Verify | 🔄 T006 merged to main |
