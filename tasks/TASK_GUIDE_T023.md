# TASK_GUIDE — T023: Bring docs in line with T017–T022
**Date**: 2026-10-30
**Complexity Level**: C0
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing anything:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Read `memory/decisions.md` § "2026-10-30 — Web agent ergonomics" (the source of truth for what changed)

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-10-30): "Do the updates need the document update also" → "yes, go update, merge and push". The Supervisor's doc audit found these passages out of date after T017–T022:

1. `RUNBOOK.md:48`: the health check says `tools/list` returns "all 11 tools". There are now 16.
2. `RUNBOOK.md:61`: it calls the `npm test` hang a sandbox quirk ("not a code bug"). That is wrong now: it was the T022 bug, and it is fixed. The real requirement is that port 8765 must be free (stop the Docker container first).
3. `README.md` "What the report shows": nothing about readable report filenames or `reports/index.html` (T021).
4. `README.md` tools section: nothing about `ui_get_page_state` returning a verified `selector` per element plus `messages`, or about `ui_click`/`ui_fill` accepting that selector unchanged (T017/T018).
5. `HARNESS.md:53`: the example `report_url` uses the old `session-<uuid>.html` name.
6. `PRD.md`: no requirement covers the five new primitives (T019), the selectors and messages (T017/T018), or the report index and readable names (T021).

**Restated intent**:
> A human or agent reading README, RUNBOOK, HARNESS or PRD gets an accurate picture of what the server does today, and a test fails if the docs' tool lists drift from the registered tools again.

**Out of scope**:
- Any change under `src/` or to existing tests' behaviour
- `AGENTS.md` (it has no tool list)
- Rewriting doc sections that are still accurate

**Requirement Refs**:
- NFR-005: AGENTS.md/HARNESS.md give a future agent enough context to extend the project
- FR-009: documented connection/usage

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor, 2026-10-30, explicit user "yes")
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Dependencies & Reachability

**Depends on**: T022 — T017–T022 integrated on `main`

**Entry point**: `README.md`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | RUNBOOK health-check row lists all 16 registered tools and says 16 | item 1 |
| 2 | RUNBOOK's `npm test` failure-mode row describes the real cause: port 8765 is held (stop the container with `docker compose stop`, run tests, then `docker compose up -d`). The "not a code bug" claim is gone | item 2 |
| 3 | README explains the report filename format `session-<YYYYMMDD-HHMMSS>-<slug>-<id8>.{json,html}` and `reports/index.html` (newest first, capped at 500) | item 3 |
| 4 | README has a short "Use the selector from page state" passage: the `{role, name, selector}` shape, the `messages` field, passing `selector` unchanged to `ui_click`/`ui_fill`, and refreshing `nth=` selectors after the page changes | item 4 |
| 5 | HARNESS example `report_url` uses the new filename format | item 5 |
| 6 | PRD: FR-004 is extended (selector + messages), and new FRs are added for the five primitives (FR-019) and readable report names + index (FR-020), each tracing to an existing US. `Last updated` is bumped | item 6 |
| 7 | **New test** `test/docs-tools.test.ts`: every tool name registered in `src/server.ts` (via `registerTool("<name>"`) appears in both `README.md` and `RUNBOOK.md`, and the RUNBOOK count matches. It fails on drift | drift test in restated intent |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Current docs, before edits | new `docs-tools` test fails (RUNBOOK lacks the 5 tools / says 11) | automated test, red |
| 2 | After edits | `docs-tools` test passes; full `npm test` green | automated test |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/docs-tools.test.ts && npx tsc --noEmit
```

The Supervisor runs the full `npm test` (with the container stopped) at Stage 5.

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T023.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T023.md`.

---

## Approach

**Pattern reference**: `test/codex-mapping.test.ts` (T015). A doc-consistency test that reads files with `fs` and asserts on their content. Imitate its size and style.

**Vital slice**: the drift test + the RUNBOOK rows (the only doc that is actively wrong).
**Cut list**:
- Restructuring README
- Documenting P3 follow-ups

Keep the edits minimal and in each file's existing voice.

---

## Edge Case Checklist

- [ ] The drift test must parse tool names from `registerTool(` calls even when the name is on the next line (it is in `src/server.ts`), and must also pick up the T019 `TOOL` constants
- [ ] Don't hard-code 16 in the test. Derive the count from `server.ts`

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `RUNBOOK.md` | rows at lines ~48 and ~61 |
| `README.md` | report naming/index + selector passage |
| `HARNESS.md` | example `report_url` |
| `PRD.md` | FR-004 extended, FR-019, FR-020, `Last updated` |
| `test/docs-tools.test.ts` | new drift test |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/**` | docs-only task |
| `memory/**`, `.claude/**`, `PROJECT_KANBAN.md` | Supervisor-owned |

---

## Test Plan

Write `test/docs-tools.test.ts` first and watch it fail on the current docs (BEFORE). Then edit the docs until it passes (AFTER).

---

## Completion Checklist

- [ ] Drift test written, red then green
- [ ] All six doc items done
- [ ] Output pasted into `tasks/TASK_REVIEW_T023.md`
- [ ] Supervisor notified
