# TASK_GUIDE — T015: Codex Mapping for the Claude Code Kit
**Date**: 2026-08-25
**Complexity Level**: C1
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
5. Apply the C1 process from that role guide

---

## Requirement (Pillar 1 — Adapt the requirement)

Add the reference for mapping Codex to the current Claude Code kit.

**Restated intent**:
> A Codex implementer and a Claude supervisor can use one current, repository-local reference to
> translate the kit's instruction, skill, hook, subagent, review, and verification concepts without
> relying on obsolete claims about Codex capabilities.

**Out of scope**:
- Porting or rewriting the Claude kit's skills and hooks for Codex
- Changing application runtime code
- Defining mappings for agentic CLIs other than Codex

**Requirement Refs**:
- NFR-005: Future agents have enough context to extend the project without re-deriving decisions

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed from the user's request
- [x] Domain terms align with the installed Claude kit and official Codex terminology
- [x] Every Acceptance Criterion below traces to the Requirement
- [x] NFR-005 exists in `PRD.md` and is covered by the Acceptance Criteria

---

## Dependencies & Reachability

**Depends on**: None

**Entry point**: `docs/MULTI_AGENT.md`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `docs/MULTI_AGENT.md` maps Claude Code instructions, skills, hooks, subagents, review/verify gates, worktrees, and memory to their current Codex equivalents or explicit gaps | current mapping reference |
| 2 | The reference includes a runnable Codex dispatch recipe and preserves `TASK_GUIDE` plus independent Evidence Gate ownership | usable by Codex implementers |
| 3 | `AGENTS.md` links to the reference without falsely claiming current Codex lacks hooks, skills, or subagents | avoid obsolete capability claims |
| 4 | An automated test fails for a missing or regressed reference and passes for the completed mapping | durable reference |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | A reader opens the Codex adapter | Its linked mapping exists and covers every required kit surface | automated test |
| 2 | A reader compares the mapping with current official Codex docs | Capabilities are described as equivalents, partial equivalents, or Claude-owned gates | review against cited official docs |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/codex-mapping.test.ts
```

### Evidence (filled by reviewer at Stage 4/5)

> Filled in `tasks/TASK_REVIEW_T015.md`.

---

## Demonstration

> Filled in `tasks/TASK_REVIEW_T015.md`.

---

## Approach

**Pattern reference**: `/home/hungnguyenhuu/.supervisor/docs/MULTI_AGENT.md` — preserve its
`TASK_GUIDE` contract and dispatch structure, while correcting its obsolete Codex capability table
against current official OpenAI documentation.

**Vital slice**: one Codex-specific capability matrix plus one dispatch recipe

**Cut list**:
- No automatic conversion of `.claude/skills/` to `.agents/skills/`
- No project-local Codex hook installation
- No Cursor/Gemini mapping expansion

Write a repository-local reference, update the thin Codex adapter's summary, and protect the mapping
with a focused Node test. Keep Claude as the final owner of this project's Stage 4/5 evidence gates
even where Codex has analogous capabilities.

---

## Edge Case Checklist

- [ ] Do not equate similarly named skills with identical project-specific behavior
- [ ] Do not claim a Claude hook automatically runs under Codex without Codex configuration
- [ ] Do not leave references to missing repository files

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `docs/MULTI_AGENT.md` | Add the current Codex-to-Claude-kit mapping and dispatch recipe |
| `AGENTS.md` | Replace obsolete capability claim with a concise mapping summary |
| `test/codex-mapping.test.ts` | Add automated reference integrity and content checks |
| `PROJECT_KANBAN.md` | Track T015 status |
| `tasks/TASK_REVIEW_T015.md` | Record Stage 4/5 evidence |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/**` | Documentation-only task |
| `.claude/**` | Canonical installed Claude kit; mapping task must not mutate it |
| `CLAUDE.md` | Canonical supervisor rules are input to the mapping, not an implementation target |

---

## Test Plan

Run the focused Node test red before the reference exists, then green after the mapping and adapter
are updated. Review every capability statement against the current installed kit and official OpenAI
documentation.

---

## Completion Checklist

- [x] Implementation done
- [x] Code review completed — evidence in `tasks/TASK_REVIEW_T015.md`
- [x] Lint N/A (Markdown plus focused Node test only)
- [x] Tests written and focused verification passes; reviewer must paste output into `tasks/TASK_REVIEW_T015.md`
- [x] Verification command passes
- [x] Supervisor notified; user directed completion and push on 2026-08-25
