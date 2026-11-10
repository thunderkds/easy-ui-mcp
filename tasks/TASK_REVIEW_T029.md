# TASK_REVIEW — T029: Multiple concurrent sessions on one MCP connection

> Sibling of `tasks/TASK_GUIDE_T029.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

<!-- Optional: the final report, only for a task run in auto mode (the user's `[auto]` or `[admin]` tag; with `[admin]`, the `Not done:` line names `merge (admin: after the auto verify pass)`,
`docs/claude-md/tracks.md` `## Auto mode`). To use it, copy the block below out of this comment, to this
place, and replace every <...>. Keep `Mode: auto` as its first line, exactly as written: T182's hook reads
it. Write it to this file before the run ends; the chat message is a copy, not the report. The same
block is the Supervisor's final chat message. It is not the `delivery-report` page and not
Evidence. A taste decision (what the user wants) also ends with the flag. Write `DEBATED` only when ≥2
Advocate `Agent` calls ran for that question, naming each Advocate's option. A decision with no Advocates is
labelled `RULE`, `FACT` or `SAFER OPTION`, never `DEBATED`. A decision flagged `⚠ decided for you` is a choice, and is never labelled `FACT`. A
safety action a rule requires (for example the backup before a delete) is `RULE` without the flag.
At Risk Medium or High, a `RULE:` counts only when it names a written rule (`path:line`,
`path § <heading>`, or `docs/claude-md/tracks.md` `### <section>`), and a `FACT:` needs a Citation
(`path:line "quoted text"`); without one it is a choice and must be `DEBATED`. Good: `2. backed up the CSV
— RULE: `docs/claude-md/tracks.md` `### Stops that stay``. Bad: `1. kept recurring.csv — RULE: Surgical Changes`.
`Memory:` records the diff-driven memory pass you run before you stop: each entry written, or `nothing new`.
After an auto verify pass the hook, never you, adds `Closed: row moved to Done <date> — …` and moves the row,
or adds `Paused: done not moved — <reason>`. It moves the row only when this block holds `Mode: auto`, a
numbered decision, `Checks:`, `Memory:`, the `Not done:` auto verify slot with its result, and `Not done:`
naming the merge — no `<...>` left (`docs/claude-md/tracks.md` `### Auto close-out`).

-->

## Auto decisions

Mode: auto
1. D1–D5 (no-id rule, cap 3, end rule, 10 min idle, `timed_out` report) and Option A were decided by the user in chat, not by the Supervisor — FACT: tasks/TASK_GUIDE_T029.md:56 "Open decisions D1–D3 below answered by the user (2026-11-10: provisional answers accepted)"
2. `AGENTS.md` left unchanged although AC11 named it: it is kit-locked and holds no tool docs — FACT: .claude/harness-lock.json:84 "AGENTS.md": "3adb3f13e9c7b1b4c190d2adf66fcaee7850ce272c97fbc1b7f8f6ceb9b1a735"
3. Code-review P3 findings (hard-coded "10 minutes"/"default 3" in the `ui_start_session` description; shared-page fallback when a chosen session vanishes mid-call) left as suggestions, not applied — RULE: `.claude/skills/code-review/SKILL.md` § Phase 4 — Apply Safe Fixes ("Present P2/P3 fixes as suggestions only")
4. Spawned backend-developer with the agent's own default model: `PROJECT_SPEC.md` has no `## CLI Model Table` — SAFER OPTION: `docs/claude-md/tracks.md` `### Every user stop and its auto rule` row 14; no Debate was run for it ⚠ decided for you — please review
5. Built T029 in its own worktree `../easy-ui-mcp-T029` (branch `task/T029-multi-session`) instead of the main checkout, because another session is planning T030–T033 in the main checkout on the same `src/server.ts` — SAFER OPTION: keeps the other session's files untouched; no Debate was run ⚠ decided for you — please review
6. Accepted the implementer's deviations from Option A: `registerSessionTool` instead of a `withSession` wrapper, AsyncLocalStorage for the per-call session id, positional `onIdle` argument, new `src/tools/connection-sessions.ts` — SAFER OPTION: same behaviour as Option A, every AC tested, code review found no P0–P2; no Debate was run ⚠ decided for you — please review
Checks: tests `node --import tsx --test test/{multi-session,session,web,docs-tools,api-run-test}.test.ts && npx tsc --noEmit` — re-run by the Supervisor: 26/26, 39/39, 52/52, 2/2, 4/4, tsc exit 0 (implementer: full `npm test` 182/182); reviews code-review — 0 P0/P1/P2, 3 P3; security-review — no findings above 80% confidence (ownership, AsyncLocalStorage, report escaping checked); real run — not yet (auto-checked, not /verify)
Memory: memory/learnings.md — "Session-aware MCP tools register through `registerSessionTool`; doc tests scan for the registration call"; memory/MEMORY.md — index line for it
Not done: merge (admin: after the auto verify pass); auto verify: running (T182); merge order with T030–T033 (all edit `src/server.ts`) — yours; readiness incomplete: `PROJECT_SPEC.md` has no `## Readiness` section (yours)

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/multi-session.test.ts` (12 ownership unit tests + 14 MCP-client tests: AC1-10, 12-14 and the edge cases), `test/session.test.ts` (idle timer, in-flight guard, onIdle failure, end/idle race, failed-then-timed_out), `test/docs-tools.test.ts` (AC11 docs mention `session_id`) |
| Verification command run | ☑ pass | `node --import tsx --test test/session.test.ts && ... web.test.ts && ... docs-tools.test.ts && npx tsc --noEmit` -> session 39/39 pass, web 52/52 pass, docs-tools 2/2 pass, tsc exit 0. Full `npm test`: `ℹ tests 182 / pass 182 / fail 0` (25 s); also green one at a time: multi-session 26/26, site 13/13, harness-snapshot 3/3, api-run-test 4/4. |
| Negative cases hold | ☑ pass | Red first: before the implementation both new test files failed to load (missing `connection-sessions.js` / `beginCall` exports). Mutations on the committed tree: (1) `git diff --stat` = `src/server.ts | 2 +-` removing `beginCall` -> `✖ a ui_wait_for that outlasts the idle limit is not killed mid-call`, pass 25 / fail 1. (2) `src/tools/connection-sessions.ts | 2 +-` making `resolve` accept any id -> 8 failures (ownership AC7 unit + MCP tests, D5 idle message, bounded memory, idle-close test), pass 18 / fail 8. Both reverted with `git checkout`. |
| verify | ☐ pass / ☐ fail / ☐ N/A | [what was observed — must literally state "pass" or "fail" here too, e.g. "skill run, feature confirmed working — pass": the merge gate scans this Notes column for the word "pass", not just the Result column] |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed `src/server.ts`, `src/tools/session.ts`, new `src/tools/connection-sessions.ts`, their callers (`src/api/run-test.ts`, `src/reports/index.ts` status rendering) and the 4 changed test files; skipped `src/tools/web.ts` (untouched, session-agnostic) |
| Full smoke suite still green (no regression) | ☑ pass | `npm test`: 182 tests, 182 pass, 0 fail (includes `api-run-test`, `health`, `reports`, `web`, `site`, `harness-snapshot`) |
| **Companion score (easy-verifier)** | ☐ pass / ☐ fail / ☐ N/A | [`overall` and `change_risk` as the tool returned them, the scope, the ref, and the absolute path of the verifier report after a literal `report:` label — e.g. "overall 86 (>= 80), change_risk pass, scope changes, ref `main...HEAD`, report: `/home/me/.easy-verifier-reports/kit/score_changes_20261028T0530Z.html`". The gate reads the path that follows `report:` and nothing else, so with no label, or a path that is absent, the row is unscored — write ☑ N/A instead. ☑ N/A with a reason when neither companion tool was run: the merge gate blocks on ☑ fail only, never on an absent or N/A row] |
| **UI: Visual regression (diff or verdict pasted)** | ☐ pass / ☐ fail / ☐ N/A | [screenshot path or LLM verdict — required for UI tasks, Hard-Stop Gate 6] |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ pass / ☐ fail / ☐ N/A | [method used + output] |
| **UI: Responsiveness at target viewports** | ☐ pass / ☐ fail / ☐ N/A | [viewports tested, any overflow findings] |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured 2026-11-10 04:41 UTC on branch `task/T029-multi-session` at `d4b1a40`, before any implementation commit; throwaway script `test/.tmp-before.ts`, one MCP client over HTTP, server spawned with `SESSION_TIMEOUT_MS=1000`; the reports dir path is shortened to `<scratch>`):

```
2026-11-10T04:41:00.535Z start #1: Session 5b99b9b7-8b03-454a-949e-97990448c100 started for target "A"
2026-11-10T04:41:00.540Z start #2: [isError] A session is already active — call ui_end_session first
2026-11-10T04:41:00.583Z end (ends #1): Session 5b99b9b7-8b03-454a-949e-97990448c100 ended (passed). Reports: <scratch>/reports/session-20261110-044100-a-5b99b9b7.json, <scratch>/reports/session-20261110-044100-a-5b99b9b7.html
2026-11-10T04:41:00.583Z IDLE case: start, wait 1.5s (SESSION_TIMEOUT_MS=1000), then end
2026-11-10T04:41:00.662Z start: Session 5959d951-7a5f-4094-9904-a19427ad1090 started for target "idle"
2026-11-10T04:41:02.166Z end: [isError] Unknown session 5959d951-7a5f-4094-9904-a19427ad1090
2026-11-10T04:41:02.166Z report files in reports dir before idle case: 3 after: 3
```

Reading: the second `ui_start_session` is refused ("A session is already active"). The idle session is silently dropped after 1 s with no report (report file count 3 -> 3), and `ui_end_session` then says "Unknown session".

**AFTER** (same throwaway script, extended to end sessions by id; captured 2026-11-10 04:48 UTC at commit `e11c312` plus the docs edits; `SESSION_TIMEOUT_MS=1000`; reports dir shortened to `<scratch>`):

```
2026-11-10T04:48:48.244Z start #1: Session aa661a4a-e5fb-4801-b80a-3608e8c2cc02 started for target "A"
2026-11-10T04:48:48.322Z start #2: Session 5ff4fb84-9891-46e0-9f51-1794ea02b5fa started for target "B"
2026-11-10T04:48:48.326Z end with no session_id (two open): [isError] Several sessions are open (aa661a4a-e5fb-4801-b80a-3608e8c2cc02, 5ff4fb84-9891-46e0-9f51-1794ea02b5fa) — pass session_id to choose one
2026-11-10T04:48:48.356Z end #1 by id: Session aa661a4a-e5fb-4801-b80a-3608e8c2cc02 ended (passed). Reports: <scratch>/reports/session-20261110-044848-a-aa661a4a.json, <scratch>/reports/session-20261110-044848-a-aa661a4a.html
2026-11-10T04:48:48.397Z end #2 by id: Session 5ff4fb84-9891-46e0-9f51-1794ea02b5fa ended (passed). Reports: <scratch>/reports/session-20261110-044848-b-5ff4fb84.json, <scratch>/reports/session-20261110-044848-b-5ff4fb84.html
2026-11-10T04:48:48.397Z IDLE case: start, wait 1.5s (SESSION_TIMEOUT_MS=1000), then end
2026-11-10T04:48:48.471Z start: Session c7c7bf24-9683-417b-a7f8-874aadfbd40c started for target "idle"
2026-11-10T04:48:49.976Z end: [isError] Session c7c7bf24-9683-417b-a7f8-874aadfbd40c was closed after 1 s idle
2026-11-10T04:48:49.976Z report files in reports dir before idle case: 5 after: 7
```

The `session-...-idle-c7c7bf24.json` written by the idle close has `status: "timed_out"` (grep count 1).

**DELTA**: one connection can now hold two sessions and drive each by `session_id`, and a forgotten session is closed after its idle limit with a `timed_out` report instead of silently vanishing.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/T029.jsonl`, never the
implementing agent alone]
