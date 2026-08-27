# TASK_REVIEW — T016: Vendor the Current Supervisor Harness Snapshot

> Independent Stage 4/5 review evidence for `tasks/TASK_GUIDE_T016.md`.

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☒ pass | `test/harness-snapshot.test.ts` checks the exact 104-file inventory, former symlink roots, repository confinement, regular-file type, SHA-256 integrity, and missing/mismatched/symlinked negative fixtures. |
| Verification command run | ☒ pass | `node --import tsx --test test/harness-snapshot.test.ts test/codex-mapping.test.ts` → `tests 2`, `pass 2`, `fail 0`; `npm run build` → exit 0. |
| Negative cases hold | ☒ pass | Absolute and parent-traversal paths are rejected. Temporary fixtures prove missing files, digest mismatches, and symlinks are all reported. The pre-fix red run reported `AGENTS.md: SHA-256 mismatch`. |
| verify | ☒ pass | Exact inventory, hash validation, T015 mapping compatibility, TypeScript build, and `git diff --check` all pass. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☒ pass | Reviewed the five symlink-to-copy conversions, lock inventory, installed adapters/docs, T016 test/guide/board changes, and direct T015 mapping compatibility. Application runtime code and dependencies were skipped because they are unchanged. |
| Full smoke suite still green (no regression) | ☒ fail — environment waiver | `npm test` → 3 test files pass and 4 fail. Health/API child servers never become healthy in this restricted environment; session/web Chromium launch fails with `sandbox_host_linux.cc ... Operation not permitted`. No application source changed. |
| **UI: Visual regression (diff or verdict pasted)** | ☒ N/A | Infrastructure-only task with no product UI. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☒ N/A | Infrastructure-only task with no product UI. |
| **UI: Responsiveness at target viewports** | ☒ N/A | Infrastructure-only task with no product UI. |

---

## Security Review

- Credential-signature scan across all vendored files: 0 matches.
- No runtime hook contains network calls or dynamic shell/process execution; such matches occur only
  in source-harness tests and instructional text.
- Lock paths are rejected before access when absolute or outside the repository, and symlinked lock
  entries are rejected before hashing.

---

## Code Review Findings

### P0 — Must Fix

None.

### P1 — Should Fix

None remaining. One negative-test coverage gap was fixed and reverified.

### P2 — Recommended

- **Confidence 100** — `.claude/hooks/tests/**` contains upstream harness-source acceptance tests
  tied to source-only commits and fixtures; an exploratory consumer-repo pytest run is therefore
  not green. Action: treat these as locked reference/source tests, or change the upstream installer
  manifest in a separate task if consumer-runnable Python coverage is desired.

### P3 — Optional

- **Confidence 100** — `test/harness-snapshot.test.ts` has one continuation line whose indentation
  is visually inconsistent but behaviorally correct. Action: let the project formatter normalize it
  if a formatter is added later.

`code-review` complete for T016: P0/P1/P2/P3 remaining = 0/0/1/1. One safe P1 test fix applied.

---

## Demonstration

**BEFORE**:

```text
.claude/agents -> /home/hungnguyenhuu/.supervisor/.claude/agents
CLAUDE.md -> /home/hungnguyenhuu/.supervisor/CLAUDE.md
MISMATCH AGENTS.md
checked=104 missing=0 mismatch=1
```

**AFTER**:

```text
✔ test/codex-mapping.test.ts
✔ test/harness-snapshot.test.ts
tests 2; pass 2; fail 0
> tsc -p tsconfig.json
```

**DELTA**: Future task branches can share a repository-local, exact-hash harness baseline instead
of depending on machine-specific absolute symlinks or silently accepting snapshot drift.

**WITNESS**: Codex Supervisor review, 2026-08-27; red/green integrity test, negative fixtures,
focused compatibility test, build, credential scan, runtime smoke probe, and bounded diff review run
in the repository workspace.
