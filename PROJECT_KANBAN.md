# PROJECT_KANBAN.md
**Last updated**: 2026-10-30

> Compact task board. Full context lives in `PROJECT_SPEC.md`. Update this file whenever a task status changes.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo
> Re-prioritized 2026-10-30 by user direction. Focus: **executable, simple, easy for an agent to drive, readable results**. Web first; Android and human-in-the-loop on hold. Listed in pickup order. T017–T019 and T021 are draft scope from the 2026-10-30 investigation — Brainstorm: `BRAINSTORMING_LOG_agent-ergonomics.md` (paths chosen provisionally by Supervisor, pending user approval). TASK_GUIDEs generated 2026-10-30.

### In Progress
- [ ] **T025** — Static docs site for Vercel (guide + how to run) in Graphite Mint; move planning prose `requirements.txt` → `docs/original-plan.md` (Vercel misread it as Python deps) | frontend-developer | C1 | Risk: Low | P1 | Requested by user 2026-10-30 after a failed Vercel deploy; reference page https://personal-agentic-claude.vercel.app/. Guide: `tasks/TASK_GUIDE_T025.md`

### Ready for Review


### Done
- [x] **T024** — Restyle `reports/index.html` in the Graphite Mint design system (Easy Kit family) | frontend-developer | C1 | Risk: Low | P1 | Requested by user 2026-10-30 (design system https://claude.ai/artifact/7DkuKJzMN6tJ9S8v2fNE8b). Guide: `tasks/TASK_GUIDE_T024.md` | **Completed 2026-10-30**: in `main` @ 6cc9e1b; npm test 131/131. Evidence: `tasks/TASK_REVIEW_T024.md`
- [x] **T023** — Bring docs in line with T017–T022 (RUNBOOK tool count + stale npm-test advice, README selectors/report index, HARNESS example, PRD FRs) + doc-drift test | backend-developer | C0 | Risk: Low | P1 | Requested by user 2026-10-30. Guide: `tasks/TASK_GUIDE_T023.md` | **Completed 2026-10-30**: in `main` @ 9f4a909; npm test 120/120. Evidence: `tasks/TASK_REVIEW_T023.md`
- [x] **T022** — `npm test` never exits: spawned test servers outlive their tests | backend-developer | C1 | Risk: Low | P0 | Found 2026-10-30 at Stage 5 for T017–T021; pre-existing on `main` (2e61df7); blocks the merge gate, which needs one clean `npm test`. Branch `task/T022-test-teardown` (on top of `integ/T017-T021-web-ergonomics`). Guide: `tasks/TASK_GUIDE_T022.md` | **Completed 2026-10-30**: in `main` @ 33aada7, pushed to origin 2026-10-30; live MCP check on the rebuilt container passed (session e2ec2b98, report `session-20261030-082528-live-check-t017-t022-e2ec2b98.html`). Evidence: `tasks/TASK_REVIEW_T022.md`
- [x] **T021** — Findable reports: `reports/index.html` (dated session list) + readable filenames `session-<label>-<date>`; clean up 803 loose screenshots in `reports/` | backend-developer | C1 | Risk: Low | P1 | Independent of T017–T019 — can run in parallel | **Completed 2026-10-30**: in `main` @ 33aada7, pushed to origin 2026-10-30; live MCP check on the rebuilt container passed (session e2ec2b98, report `session-20261030-082528-live-check-t017-t022-e2ec2b98.html`). Evidence: `tasks/TASK_REVIEW_T021.md`
- [x] **T019** — Missing primitives: `ui_select_option`, `ui_press_key` (Enter/Tab/Escape), `ui_hover`, `ui_set_checked`, `ui_scroll` (file upload deferred) | backend-developer | C2 | Risk: Low | P1 | Blocked by: T018. Names provisional — pending user confirmation (`ui_check` already exists as the soft assert) | **Completed 2026-10-30**: in `main` @ 33aada7, pushed to origin 2026-10-30; live MCP check on the rebuilt container passed (session e2ec2b98, report `session-20261030-082528-live-check-t017-t022-e2ec2b98.html`). Evidence: `tasks/TASK_REVIEW_T019.md`
- [x] **T018** — Return a usable locator per element from `ui_get_page_state` (test-id / id / role+name), accepted by `ui_click`/`ui_fill` | backend-developer | C2 | Risk: Medium | P0 | Blocked by: T017. Removes CSS-selector guessing, the main source of failed clicks | **Stage 4 code + security review passed 2026-10-30** (0 P0/P1/P2, 3 P3): branch `task/T018-actionable-selectors` @ `287fba0` (stacked on T017). Supervisor round-trip: every selector hit its own element incl. `Save` vs `Save as draft` and duplicate `Delete`s; 84/84 tests. Evidence: `tasks/TASK_REVIEW_T018.md`. **Awaiting user OK to merge** | **Completed 2026-10-30**: in `main` @ 33aada7, pushed to origin 2026-10-30; live MCP check on the rebuilt container passed (session e2ec2b98, report `session-20261030-082528-live-check-t017-t022-e2ec2b98.html`). Evidence: `tasks/TASK_REVIEW_T018.md`
- [x] **T017** — Fix `ui_get_page_state`: inputs named by `<label for>`/placeholder (currently dropped — reproduced 2026-10-30: email + search inputs absent from output), and surface `role=alert`/error text | backend-developer | C1 | Risk: Low | P0 | Guide: `tasks/TASK_GUIDE_T017.md`. Root cause: `web.ts:244` `innerText ?? placeholder` — input `innerText` is `""`, not nullish | **Completed 2026-10-30**: in `main` @ 33aada7, pushed to origin 2026-10-30; live MCP check on the rebuilt container passed (session e2ec2b98, report `session-20261030-082528-live-check-t017-t022-e2ec2b98.html`). Evidence: `tasks/TASK_REVIEW_T017.md`
- [x] **T014** — Human-readable reports: `ui_step` + grouped renderer + durations + console/network capture | backend-developer | C2 | Risk: Low | **P0 (raised 2026-10-30 — readable results is a top goal; closest to Done)** | Implemented 2026-08-17; 46 focused tests pass; full suite 66/68 with 2 pre-existing API report-path failures; live drive rendered 3 labelled steps + captured console/network issues without changing the verdict | **Completed 2026-10-30**: user approved readability; responsiveness evidence filled (P3 follow-up: long text overflows its card). Code was merged to main via PR #3 on 2026-08-17
- [x] **T016** — Vendor the current Supervisor harness snapshot with integrity verification | common-infrastructure | C2 | Risk: Medium | P1 | Local reference only: focused integrity + T015 mapping tests and build pass; credential scan clean; remote T016 branch intentionally removed 2026-08-27
- [x] **T015** — Codex mapping reference for the current Claude Code kit | common-infrastructure | C1 | Risk: Low | P1 | Completed: 2026-08-25; focused test and build pass; environment-blocked full-suite result disclosed in `tasks/TASK_REVIEW_T015.md` and accepted by user direction
- [x] **T013** — Truthful verdicts: `ui_check` + `ui_wait_for` + screenshot dedupe/budget | backend-developer | C2 | Risk: Medium | P0 | Completed: 2026-08-17 (PR #2); 19/19 tests + Supervisor live re-verify (soft→passed, hard→failed), evidence in `reports/evidence/T013/`; api-run-test 2/4 failures pre-existing (port 8765). Note for T007: `session.ts` gained `soft` on `LoggedAction` + 2 record fields — merge with the `kind` discriminant carefully
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

## On Hold

> Parked 2026-10-30 by user direction ("simple as is"). Not abandoned; revisit after T017–T021.

- [ ] **T007** — Appium session lifecycle: android_start_session/android_end_session + session.ts kind discriminant | backend-developer | C2 | Risk: Medium | P2 | **Uncommitted WIP** in worktree `easy-ui-mcp-T007` (dated 2026-07-09): +347 new lines (`android-session.ts` + test), 256 changed; 4/6 tests pass, the 2 failures hit the `main` container on port 8765. Branch is 12 commits behind `main`; T013/T014 rewrote `session.ts`/`server.ts`/`reports/index.ts` — expect conflicts. uiautomator2 driver still not installed
- [ ] **T008** — android_tap primitive + report wiring (tracer bullet) | backend-developer | C1 | Risk: Low | P2 | Blocked by: T007
- [ ] **T009** — android_input + android_swipe primitives | backend-developer | C1 | Risk: Low | P2 | Blocked by: T007
- [ ] **T010** — android_assert + android_get_screen_state primitives | backend-developer | C1 | Risk: Low | P2 | Blocked by: T007
- [ ] **T011** — android_take_screenshot + android failure-capture story | backend-developer | C1 | Risk: Medium | P2 | Blocked by: T007
- [ ] **T012** — Android smoke suite + end-to-end verification + docs | qa-expert | C1 | Risk: Low | P2 | Blocked by: T008–T011
- **Revisit gate for Android**: first try the official `appium-mcp` or `mobile-mcp` next to easy-ui-mcp on one real flow. If adequate → drop T008–T012 and document the pairing in `AGENTS.md`; only build in-house if Android results must share the web report format.
- **T020 (draft, not created)** — Saved-login reuse (`storageState`) + `ui_request_human(reason)` pause tool | C2 | Risk: Medium–High | P2. Needs a PRD scope change first (auth is Out of Scope). iOS: not planned — requires macOS/Xcode, incompatible with the Linux-Docker design.
- **Deferred enhancements (noted 2026-10-30, no task IDs yet)**:
  - Browser setup options on `ui_start_session` — navigation timeout (fixed 15s today), viewport size, mobile-size emulation | small
  - Playwright trace on failure — strong for debugging, but breaks the single-file self-contained report rule
  - Live browser view a human can watch/take over — needs extra Docker components (e.g. VNC); pairs with T020

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
| 3 Execution | ⏸ On hold (2026-10-30) — T006 done; T007 has uncommitted WIP; web tasks T017–T021 take priority |
| 4 Review | ✅ T006 reviewed (0 P0/P1, 1 P2 carried into T007); nothing awaiting review for v2 |
| 5 Integration & Verify | ✅ T006 merged to main; T007–T012 pending |
