# TASK_GUIDE — T016: Vendor the Current Supervisor Harness Snapshot
**Date**: 2026-08-27
**Complexity Level**: C2
**Risk Level**: Medium
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
5. Apply the C2 process from that role guide
6. Read `memory/codebase-map.md` if it exists

---

## Requirement (Pillar 1 — Adapt the requirement)

Keep the current local Supervisor harness update usable across task branches without creating
repeated conflicts; start a new task if repository work is required.

**Restated intent**:
> Replace machine-specific absolute harness symlinks with one portable, integrity-checked project
> snapshot. Future task branches can share this baseline, and intentional project customizations
> remain distinguishable from accidental harness drift.

**Out of scope**:
- Modifying the shared `/home/hungnguyenhuu/.supervisor` installation
- Changing application runtime code under `src/`
- Pushing or merging the local reference into `main`
- Automatically synchronizing future shared-harness releases

**Requirement Refs**:
- NFR-005: Future agents have enough repository-local context to extend the project

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed from the user's instruction to do the necessary local work and start a task if required
- [x] Harness snapshot and project adapter terminology matches the installed files and T015 mapping
- [x] Every Acceptance Criterion below traces to the Requirement
- [x] NFR-005 exists in `PRD.md` and is covered by the Acceptance Criteria

---

## Dependencies & Reachability

**Depends on**: T015 — the repository-local Codex adapter and capability mapping must remain intact

**Entry point**: `.claude/harness-lock.json`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | The five previously absolute harness links are vendored as repository-local files/directories | portable project snapshot |
| 2 | Every path recorded in `.claude/harness-lock.json` is relative, remains inside the repository, exists as a regular file, and matches its SHA-256 digest | integrity-checked baseline |
| 3 | The lock records the current T015 `AGENTS.md` customization rather than a stale pre-T015 digest | intentional customization remains distinguishable from drift |
| 4 | A focused automated test fails on a missing, unsafe, symlinked, or hash-mismatched snapshot entry | durable conflict/drift detection |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | A clean checkout on a machine without `/home/hungnguyenhuu/.supervisor` | The repository-local harness files remain readable | automated test plus Git mode review |
| 2 | Any locked file content changes without refreshing the lock | Focused verification reports its exact path as a digest mismatch | automated test |
| 3 | A lock entry attempts an absolute path or `..` traversal | Focused verification rejects it before reading outside the repository | automated test |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/harness-snapshot.test.ts && npm run build
```

### Evidence (filled by reviewer at Stage 4/5)

> Filled in `tasks/TASK_REVIEW_T016.md`.

---

## Demonstration

> Filled in `tasks/TASK_REVIEW_T016.md`.

---

## Approach

**Pattern reference**: `test/codex-mapping.test.ts` — use a focused Node test to protect a
repository-level agent contract without coupling it to application runtime code.

**Vital slice**: validate repository confinement, regular-file type, and SHA-256 for every lock entry

**Cut list**:
- No automatic lock regeneration command
- No changes to the shared `.supervisor` source
- No remote push, merge into `main`, or task-branch rebase

Treat the already-installed project snapshot as the candidate implementation. Add a strict,
portable integrity oracle; refresh only the stale `AGENTS.md` digest caused by the accepted T015
adapter change; then review all vendored files for unsafe paths or secret material.

---

## Edge Case Checklist

- [ ] Reject absolute and parent-traversal lock paths
- [ ] Reject symlinks in locked file entries
- [ ] Report all missing and mismatched files, not only the first
- [ ] Keep application source and dependency manifests unchanged

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `.claude/agents/**` | Vendor the installed agent definitions |
| `.claude/hooks/**` | Vendor hooks, helpers, and their tests |
| `.claude/skills/**` | Vendor the installed skill definitions |
| `CLAUDE.md` | Vendor the canonical Supervisor rules |
| `templates/**` | Vendor task and report templates |
| `.claude/harness-lock.json` | Record the snapshot hashes, including current `AGENTS.md` |
| `.cursor/rules/agent-base.mdc` | Preserve the installed cross-CLI adapter |
| `docs/claude-md/**` | Preserve the split canonical Supervisor references |
| `test/harness-snapshot.test.ts` | Verify safe paths, file types, and hashes |
| `PROJECT_KANBAN.md` | Track T016 state |
| `tasks/TASK_GUIDE_T016.md` | Lock task scope and acceptance criteria |
| `tasks/TASK_REVIEW_T016.md` | Record independent review and verification evidence |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/**` | Harness portability does not change application behavior |
| `package.json` / `package-lock.json` | Verification uses Node built-ins and existing `tsx` tooling |
| `memory/**` | No durable project/product decision is established until T016 is accepted and delivered |

---

## Test Plan

Run the integrity oracle before refreshing the known stale digest to capture a red result. Refresh
only `AGENTS.md` in the lock, rerun the focused test, run the TypeScript build, then inspect Git
modes and scan the vendored text for credential-like material before review.

---

## Completion Checklist

- [x] Implementation done
- [x] Code review completed — evidence in `tasks/TASK_REVIEW_T016.md`
- [x] Security review completed — Medium-risk shared harness surface
- [x] Lint N/A — no configured lint script; `git diff --check` passes
- [x] Tests written and pass — output pasted into `tasks/TASK_REVIEW_T016.md`
- [x] Verification command passes
- [x] KANBAN updated to the verified state
- [x] Local reference retained at `2bbf1e3`; remote T016 branch intentionally removed by user direction
