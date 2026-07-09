# PROJECT_KANBAN.md
**Last updated**: 2026-07-01

> Compact task board. Full context lives in `PROJECT_SPEC.md`. Update this file whenever a task status changes.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo
- [ ] **T006** — Docker/infra: bundle adb, Appium deps, local-emulator connection guide | common-infrastructure | C1 | Risk: Low | P0 | Blocked by: None
- [ ] **T007** — Appium session lifecycle: android_start_session/android_end_session + session.ts kind discriminant | backend-developer | C2 | Risk: Medium | P0 | Blocked by: T006
- [ ] **T008** — android_tap primitive + report wiring (tracer bullet) | backend-developer | C1 | Risk: Low | P0 | Blocked by: T007
- [ ] **T009** — android_input + android_swipe primitives | backend-developer | C1 | Risk: Low | P1 | Blocked by: T007
- [ ] **T010** — android_assert + android_get_screen_state primitives | backend-developer | C1 | Risk: Low | P1 | Blocked by: T007
- [ ] **T011** — android_take_screenshot + android failure-capture story | backend-developer | C1 | Risk: Medium | P1 | Blocked by: T007
- [ ] **T012** — Android smoke suite + end-to-end verification + docs | qa-expert | C1 | Risk: Low | P0 | Blocked by: T008, T009, T010, T011

### In Progress

### Ready for Review

### Done
- [x] **T001** — Docker + MCP server skeleton + ui_navigate tracer bullet | C2 | Completed: 2026-07-01
- [x] **T002** — Remaining primitive Playwright tools | C1 | Completed: 2026-07-01
- [x] **T003** — Session lifecycle + JSON/HTML report generation | C2 | Completed: 2026-07-01
- [x] **T004** — REST API wrapper (/api/run-test) + /health | C1 | Completed: 2026-07-01
- [x] **T005** — AGENTS.md / HARNESS.md documentation | C0 | Completed: 2026-07-01

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
| 3 Execution | ⬜ Not started |
| 4 Review | ⬜ Not started |
| 5 Integration & Verify | ⬜ Not started |
