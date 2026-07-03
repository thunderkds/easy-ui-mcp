# learnings.md — Cold Tier: Clarifications, Patterns & Gotchas

> **Rules**: Supervisor-only writes. Each entry dated (`YYYY-MM-DD`) and citing the file/task it came from (the diff-driven pass greps this file by changed file path).

## Requirement Clarifications

## Patterns

### 2026-07-01 — Express: always add a JSON-parse error handler after `express.json()`
**Pattern**: Malformed JSON request bodies fall through to Express's default error handler if no custom one is registered, which echoes the parser's raw stack trace — including internal container file paths (`/app/node_modules/body-parser/...`) — back to the caller. Add a minimal error-handling middleware right after `app.use(express.json())` that catches `SyntaxError` with a `body` property and returns a clean 400.
**Files**: `src/server.ts`
**Source**: T001, found live during Stage 5 `verify` (not caught by code-review alone — confirmed by actually sending a malformed body to the running server).

### 2026-07-01 — flow_description resolves to a session label, not a parsed step list (T004 precedent)
**Pattern**: When a task's requirement mentions an NL-ish field (`flow_description`) but the project's Critical Constraint forbids server-side LLM calls, the correct resolution is to use that field only as a human-readable label on the session/report, not to interpret it into steps. `POST /api/run-test`'s `flow_description` follows this pattern — it labels the session; the actual behavior is a fixed single-navigate-and-screenshot smoke check via `app_url_or_package`. Follow this same pattern for any future REST/tool surface that accepts a natural-language field in this project.
**Files**: `src/api/run-test.ts`

### 2026-07-01 — Documentation claims need independent re-verification, not trust in agent self-report
**Pattern**: T005's implementing agent reported "verified against running container" for AGENTS.md, but code review found it had never actually checked one specific claim (a `src/tools/mobile.ts` stub that doesn't exist in the repo) — the agent's self-reported verification checklist didn't cover every individual sentence. When reviewing documentation tasks, independently re-run every command/example and cross-check every factual claim against the actual repo (e.g. `ls` for claimed files) rather than trusting the implementer's evidence table at face value.
**Files**: `AGENTS.md`, `HARNESS.md`

## Gotchas

### 2026-07-01 — Worktree-isolated agents can't see uncommitted Stage 1/2 planning docs
**Gotcha**: `PROJECT_SPEC.md`, `PRD.md`, `PROJECT_KANBAN.md`, `tasks/TASK_GUIDE_*.md`, `.claude/agents/`, etc. must be **committed to `main`** before spawning any `isolation: "worktree"` agent — a worktree is created from the last commit, so uncommitted planning artifacts in the main working directory are invisible to it. T001's first spawn attempt correctly self-blocked (Hard-Stop Gate 1) when it found none of these files in its worktree.
**Files**: N/A (process gotcha, not a specific file)

### 2026-07-01 — Worktree agents default to origin/main, not local main
**Gotcha**: By default, `Agent({ isolation: "worktree" })` branches new worktrees from `origin/<default-branch>` (the "fresh" baseRef mode), not local `main`. Since this project's commits are local-only (never pushed to `origin`), every worktree-isolated agent saw only the stale "Initial commit" — none of the merged T001 work or planning docs. Fixed by adding `"worktree": { "baseRef": "head" }` to `.claude/settings.json`, which branches new worktrees from local HEAD instead.
**Files**: `.claude/settings.json`

### 2026-07-01 — npm test's multi-file glob can hang in this sandbox (not a code bug)
**Gotcha**: `node --import tsx --test test/**/*.test.ts` under `--test-isolation=process` sometimes leaves a zombie child process after a test file's assertions have already printed and passed, causing the overall `npm test` command to appear to hang indefinitely (observed during T004 review — reproduced twice). This is a sandbox/test-runner resource-cleanup quirk, not an application regression: confirmed by (a) manually curling the live endpoint directly (sub-second response), and (b) running each test file individually with `node --import tsx --test test/<file>.test.ts`, which completes and exits cleanly. If `npm test` appears stuck during Stage 4/5 review, don't assume a regression — kill the process, verify the live endpoint by hand, then re-run test files one at a time before concluding there's a real bug.
**Files**: `package.json` (test script), N/A (environment-level, not project-code)

### 2026-07-01 — pre_bash_block_unsafe_merge.py Evidence-row regex is picky about phrasing (corrected)
**Gotcha**: The merge-gate hook checks the regex `verify\s*\|[^|\n]+\|[^|\n]*pass` against the task guide. This requires **two** things: (1) the word "verify" immediately followed by a `|` — so keep the Check-column cell text to just `verify`, not a longer phrase like `` `verify` skill — works in running app `` (the TASK_GUIDE template's default phrasing fails this); AND (2) the literal word "pass" must appear somewhere in the **third** cell (Notes/output snippet), not just the Result cell — `| verify | ✅ pass | <notes> |` only matches if `<notes>` itself also contains the word "pass" (e.g. "18/18 tests pass"), because the regex's `[^|\n]*pass` group matches against the third cell, and the "✅ pass" in the second cell gets consumed by the regex's middle `[^|\n]+` group. Write the verify row's Notes cell so it naturally states something passed (not just describes what was tested) — this is usually true anyway (e.g. "N/N tests pass"), so it's not gaming the check.
**Files**: `.claude/hooks/pre_bash_block_unsafe_merge.py`, `templates/TASK_GUIDE_template.md`
