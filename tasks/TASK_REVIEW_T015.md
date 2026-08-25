# TASK_REVIEW — T015: Codex Mapping for the Claude Code Kit

> Independent Stage 4/5 review evidence for `tasks/TASK_GUIDE_T015.md`.

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☒ pass | `test/codex-mapping.test.ts` checks reference reachability, every required capability term, official documentation links, the dispatch recipe, and explicit Claude-owned Evidence Gate statements. An adversarial ownership mutation passed before the added semantic assertions and is now rejected. |
| Verification command run | ☒ pass | `node --import tsx --test test/codex-mapping.test.ts` → `tests 1`, `pass 1`, `fail 0`. |
| Negative cases hold | ☒ pass | Replacing every `Claude` ownership statement with `Codex` previously satisfied all keyword assertions; the added policy assertions reject that regression. Missing mapping/reference terms are also rejected. |
| verify | ☒ pass | Focused reference test and `npm run build` pass; official OpenAI documentation confirms the mapped AGENTS.md, skills, subagents, and hooks mechanisms. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☒ pass | Reviewed `AGENTS.md`, `docs/MULTI_AGENT.md`, `test/codex-mapping.test.ts`, the T015 guide/board entries, and current official Codex documentation. Application runtime files were skipped because T015 is documentation-only. |
| Full smoke suite still green (no regression) | ☒ fail — environment waiver | `npm test` → 2 test files pass and 4 fail. The API/health tests cannot create the `tsx` IPC socket (`listen EPERM ... /tmp/tsx-1000/*.pipe`); session/web tests cannot launch Chromium (`sandbox_host_linux.cc ... Operation not permitted`). No application source changed. User directed T015 to Done and push on 2026-08-25 with this limitation disclosed. |
| **UI: Visual regression (diff or verdict pasted)** | ☒ N/A | Documentation/reference task with no product UI. |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☒ N/A | Documentation/reference task with no product UI. |
| **UI: Responsiveness at target viewports** | ☒ N/A | Documentation/reference task with no product UI. |

---

## Demonstration

**BEFORE**: The previous adapter stated: “Codex has no equivalent of Claude Code's hooks, skills,
or `Skill`/`Agent` tooling.”

**AFTER**: `docs/MULTI_AGENT.md` provides a current capability matrix, official references, a
runnable `codex exec` dispatch recipe, and an explicit independent Evidence Gate boundary.

**DELTA**: A Claude supervisor can now dispatch a task-guide-bound Codex implementer without relying
on obsolete Codex capability claims or surrendering independent acceptance ownership.

**WITNESS**: Codex reviewer, 2026-08-25; focused test, build, adversarial mutation check, CLI help,
and official OpenAI documentation review run in the repository workspace.
