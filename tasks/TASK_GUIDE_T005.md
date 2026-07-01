# TASK_GUIDE — T005: AGENTS.md / HARNESS.md Documentation
**Date**: 2026-07-01
**Complexity Level**: C0
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: common-infrastructure
**Agent guide**: `.claude/agents/common-infrastructure.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/common-infrastructure.md`
5. C0 task — apply the lightweight C0 process from the Complexity matrix in `.claude/agents/general-agent-template.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

Write `AGENTS.md` and `HARNESS.md` at the project root, documenting how a future agent (human or AI) connects to and extends this project, based on the actual final shape of T001–T004.

**Restated intent**:
> `AGENTS.md` gives any future agent enough context to extend the project without re-deriving architecture decisions — especially the exact Claude Code MCP connection configuration. `HARNESS.md` documents how the REST wrapper (`/api/run-test`) can be called by an external process, even though pipeline integration itself is out of scope for v1.

**Out of scope**:
- Any new pipeline integration code — this is documentation only
- Mobile/v2 details beyond a "deferred" note

**Requirement Refs** (from `PRD.md`):
- FR-009: AGENTS.md must document the exact MCP connection configuration Claude Code needs
- NFR-005: AGENTS.md and HARNESS.md must give a future agent enough context to extend the project without re-deriving architecture decisions

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `AGENTS.md` includes the exact, copy-pasteable Claude Code MCP connection config for this server, tested against the running container | FR-009 |
| 2 | `AGENTS.md` documents the architecture decision (primitive tools, no server-side LLM, session bracketing) and the Critical Constraints from `PROJECT_SPEC.md` | NFR-005 |
| 3 | `HARNESS.md` documents `/api/run-test` request/response shape with a working `curl` example | NFR-005, Phase 3 intent |
| 4 | Both docs note mobile/v2 as explicitly deferred, avoiding future agent confusion | NFR-005 |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Follow `AGENTS.md`'s connection steps exactly, with the container running | Claude Code connects successfully and can call a tool | manual verification |
| 2 | Run the `curl` example from `HARNESS.md` exactly as written | Returns a valid response matching the documented shape | manual verification |

### Verification Command (exact, runnable)

```bash
# Run the exact curl example pasted into HARNESS.md and confirm it matches the documented response shape
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ N/A | Documentation-only task — verification is manual per Success Criteria above |
| Verification command run | ☐ pass / ☐ fail | |
| Negative cases hold | ☐ N/A | |
| `verify` skill — works in running app | ☐ pass / ☐ fail | |
| Review scope bounded to the change's blast radius | ☐ pass / ☐ fail | |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| **UI: Visual regression** | ☐ N/A | No UI |
| **UI: Design-system compliance** | ☐ N/A | No UI |
| **UI: Responsiveness** | ☐ N/A | No UI |

---

## Approach

Write these after T001–T004 are complete so the documented connection config and API shape are accurate, not aspirational. Keep both files concise — link to `PROJECT_SPEC.md`/`PRD.md` for deep context rather than duplicating it.

---

## Edge Case Checklist

- [ ] Documented connection config must be tested against the actual running container, not written from memory of the spec

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `AGENTS.md` | New — architecture summary, MCP connection config, constraints |
| `HARNESS.md` | New — REST wrapper usage, curl example |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| Any `src/` file | Documentation-only task, no code changes |

---

## Test Plan

Manual: follow both documents step-by-step exactly as a fresh reader would, confirm every command/config works as written.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes (N/A for markdown, skip)
- [ ] Tests written AND pass — N/A, manual verification evidence pasted instead (documentation task)
- [ ] `Skill({ skill: "verify" })` run — confirmed both docs work as written
- [ ] `memory/MEMORY.md` updated (if new patterns or feedback learned)
- [ ] Supervisor notified: task ready for Stage 4 review
