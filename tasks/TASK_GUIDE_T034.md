# TASK_GUIDE — T034: Commit the Easy Kit harness sync and bring the harness tests in line
**Date**: 2026-11-10
**Risk Level**: Medium (touches the vendored harness, its integrity lock and two tests; no app code)
**Assigned agents**: common-infrastructure

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `memory/MEMORY.md` and this guide instead.)

## Requirement
User, 2026-11-10: "fix the harness tests too", then chose "Commit sync + update tests". Two tests fail on main:
- `test/harness-snapshot.test.ts` — asserts `.claude/agents` / `.claude/skills` are real directories and that `.claude/harness-lock.json` covers exactly the vendored files with matching sha256. The user's harness move (commits 1539ccb, 91c5d6e) made them symlinks to `agents/` and `skills/`, and the user's uncommitted Easy Kit sync (kit commit d1b8b52) left the lock listing a mix of old and new paths (27 hash mismatches, 1 missing file).
- `test/codex-mapping.test.ts` — asserts AGENTS.md contains "Claude supervisor still owns the canonical review, … verification, KANBAN, and memory gates"; AGENTS.md v1.18 from the kit no longer has that sentence (it still points to `docs/MULTI_AGENT.md`, line ~196).

## Acceptance Criteria
- [ ] The user's uncommitted harness sync is committed as-is in its own commit (no edits to its content), excluding `.claude/agents.bak/`, `.claude/skills.bak/`, `.claude/hooks/.state/**` and `__pycache__`.
- [ ] `.claude/harness-lock.json` keys = exactly the vendored file set of the new layout, each with the sha256 of the committed file; `kit_commit`/`claude_md_source` kept.
- [ ] `test/harness-snapshot.test.ts` checks the new layout: `agents/`, `skills/` (and any other vendored roots the lock holds, e.g. `packs/`, `scripts/`, `docs/` kit files, `.claude/hooks`, `.cursor/rules`, `docs/claude-md`, `templates`, `.claude/sensitive-paths.txt`, AGENTS.md, CLAUDE.md) are regular, non-symlinked; `.claude/agents` and `.claude/skills` are symlinks resolving to `../agents` / `../skills`; runtime state (`.claude/hooks/.state/`, `__pycache__`) is excluded.
- [ ] `test/codex-mapping.test.ts` still guards the policy boundary, but asserts it in a project-owned place (`docs/MULTI_AGENT.md`) and only checks AGENTS.md for the `docs/MULTI_AGENT.md` pointer.
- [ ] `.gitignore` covers `.claude/agents.bak/`, `.claude/skills.bak/` and `.claude/hooks/.state/` if not already.
- [ ] Full `npm test` on main: 0 failures.

## Approach
1. Run only after T031–T033 are merged and main has no merge in progress.
2. Commit the harness sync (explicit paths from `git status`, never `git add -A`).
3. Regenerate the lock with a one-off script from the committed file set (sha256), keep the two metadata fields.
4. Update the two tests (test-first: confirm red on the current tree, green after).
5. Commit lock + tests together.

## Files to change (predicted)
| File | Change |
|------|--------|
| (user's ~94 harness files) | commit as-is |
| `.claude/harness-lock.json` | regenerate for the new layout |
| `test/harness-snapshot.test.ts` | new layout, symlink expectations, exclude runtime state |
| `test/codex-mapping.test.ts` | move the policy-boundary assertion off AGENTS.md |
| `.gitignore` | ignore `.bak` dirs and hook runtime state if missing |

## Files must NOT touch
| File | Reason |
|------|--------|
| Content of any vendored harness file (AGENTS.md, CLAUDE.md, hooks, skills, agents, templates) | kit-owned; commit as-is |
| `src/**`, other tests | out of scope |

## Test plan
`node --import tsx --test test/harness-snapshot.test.ts test/codex-mapping.test.ts` red before, green after; then full `npm test`.

## Verification Command
```
node --import tsx --test test/harness-snapshot.test.ts test/codex-mapping.test.ts && npm test
```

## Completion checklist
- [ ] Implementation done
- [ ] Tests pass
- [ ] `memory/` updated (if new patterns learned)
- [ ] TASK_GUIDE marked complete
