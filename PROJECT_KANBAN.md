# PROJECT_KANBAN.md
**Last updated**: 2026-07-01

> Compact task board. Full context lives in `PROJECT_SPEC.md`. Update this file whenever a task status changes.

---

## Board

> Task line format: **Txxx** — [title] | [agent] | C[0–3] | Risk: Low/Med/High | P[0–2]

### Todo
- [ ] **T002** — Remaining primitive Playwright tools | backend-developer | C1 | Risk: Low | P0
- [ ] **T003** — Session lifecycle + JSON/HTML report generation | backend-developer | C2 | Risk: Low | P0
- [ ] **T004** — REST API wrapper (/api/run-test) + /health | backend-developer | C1 | Risk: Low | P1
- [ ] **T005** — AGENTS.md / HARNESS.md documentation | common-infrastructure | C0 | Risk: Low | P1

### In Progress

### Ready for Review
- [ ] **T001** — Docker + MCP server skeleton + ui_navigate tracer bullet | common-infrastructure | C2 | Risk: Med | P0 | Started: 2026-07-01


### Done

---

## Blocked

| Task | Reason | Waiting on |
|------|--------|-----------|
| T002 | Needs working MCP server + connectivity proof | T001 |
| T003 | Needs primitive tools to log against | T002 |
| T004 | Needs session/report model to wrap | T003 |
| T005 | Needs final tool/connection shape to document accurately | T001–T004 |

---

## Stage Tracker

| Stage | Status |
|-------|--------|
| 0.5 Brainstorming | ✅ Done |
| 1 Environment Setup | ✅ Done |
| 1.5 Sub-Agent Architecture | ✅ Done |
| 2 Planning (/plan) | ✅ Done |
| 3 Execution | ⬜ Not Started |
| 4 Review | ⬜ Not Started |
| 5 Integration & Verify | ⬜ Not Started |
