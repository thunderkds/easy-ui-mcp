# TASK_REVIEW — T046: Simpler README; the detailed guide lives on the index page

> Sibling of `tasks/TASK_GUIDE_T046.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Evidence

| Check | Result | Notes |
|-------|--------|-------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/site.test.ts`: the T039 README assertions rewritten (positioning line, The problem / Why use it / Quick Start order, 7-row why table with rows ≤ 260 characters, README ≤ 60 lines, every `https://easy-ui-mcp.vercel.app/#id` link has a matching site id, no relative `site/index.html#` anchor, the four docs linked); new `T046: the page holds what the README no longer does` (stdio, Scope (v1), More docs, sidebar entries) and `T046: finer reference detail from the old README is on the page` (13 moved strings). Both written first and failed on the 207-line README (implementer: `README is at most 60 lines (now 207)`, `sidebar links to #stdio`) |
| Verification command run | ☑ pass | Supervisor on e0da797 (worktree): `node --import tsx --test test/site.test.ts test/docs-tools.test.ts` → tests 23, pass 23, fail 0; `npm test` → tests 383, suites 9, pass 383, fail 0 (port 8765 free; `test/docs-tools.test.ts` unedited, so the README still names all 26 tools and `session_id`) |
| Negative cases hold | ☑ pass | The new assertions fail on the starting README (207 lines, no `#stdio` section) and pass after. Supervisor fact check, old README (`8449c12`) against new README + site: 177 backticked tokens, 0 missing; no number missing. Spot-check strings from the guide: all present |
| verify | ☑ pass | pass — Supervisor real run 2026-11-12 on e0da797: the site loaded from the branch in headless Chromium at 375 and 1280 px; all 9 README guide anchors (`#reports #measured #another-repo #tools #several-sessions #stdio #networking #scope #more-docs`) resolve to a visible section with its heading and a sidebar link; 0 console or page errors; no sideways scroll (`scrollWidth` 375/1280); the five linked docs exist. Screenshots read: `#stdio`, `#scope`, `#more-docs`, `#seeing-the-page` at 375 and `#stdio`, `#scope` at 1280 |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | `README.md`, `site/index.html`, `test/site.test.ts`; repo-wide grep for references to removed README headings or `README#` anchors found none outside task and memory notes |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 383/383 on e0da797 (Supervisor run, separate from the implementer's) |
| Code review | ☑ pass | Supervisor, `reports/code-review_worktree-agent-a3e0f3112cb7ec47c_20261112T110010.html`. 0 P0. **P1 (process), recorded, not a code defect:** the implementer's report had no `Startup reads:` line; asked, it confirmed it did not open `PROJECT_SPEC.md` or the brainstorm log before its first edit, and read `agents/frontend.md` and `memory/MEMORY.md` only in part; the spawn prompt also lacked the Startup reads block (Supervisor's miss). The output was checked independently instead (above), so the work was not redone. P2: no UX criteria in the guide, baseline checks only; waived (docs sections, no actions or states). P3: moved bullets repeat some facts already in the section's More detail paragraph; 4 touch targets under 44px in the existing header and hero (`fail (older)`, not changed here); a test message says six where the check is at least six. `lane_check`: C1, 3 files, 327 lines, EXCEEDS 250: verbatim text moved onto the site, label kept |
| Security review | ☑ pass | Supervisor, `reports/security-review_worktree-agent-a3e0f3112cb7ec47c_20261112T110010.html`. No findings: static markup only, no script, event handler or external resource; no untrusted input; entities escaped; new links are absolute GitHub URLs in the same organisation; no secrets; the moved text keeps its security statements |
| **Companion score (easy-verifier)** | ☑ N/A | easy-verifier not run in this session |
| **UI: Visual regression (diff or verdict pasted)** | ☑ N/A | three static sections plus text in existing `<details>` blocks, using existing markup; screenshots read at both widths (see `verify`) |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ N/A | no new styles; the existing `site.test.ts` token and class tests pass |
| **UI: Responsiveness at target viewports** | ☑ N/A | checked at 375 and 1280 in the `verify` row: no sideways page scroll; long code lines scroll inside their own `pre` (`overflow-x: auto`) |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair.

**BEFORE**: captured 2026-11-12 on `main` at 7b24a59 (README content identical to 8449c12), by the Supervisor, before any implementation commit: `README.md` 207 lines, 3,198 words, 21,087 characters, 2 top-level parts, 13 subsections (highlights lines 9–42, detail 165 lines); 26 tools named. `site/index.html` 976 lines, 20 sections; no `mcp-proxy -- node dist/stdio.js`, no Scope note, no links to AGENTS.md, HARNESS.md, RUNBOOK.md or PRD.md.

**AFTER**: captured 2026-11-12 on the T046 branch at e0da797, by the Supervisor: `README.md` 44 lines, 507 words, 3,800 characters; a title and four sections (The problem, Why use it, Quick Start, More), a one-line list of all 26 tools, `session_id` once, a short stdio note, and 8 absolute guide anchor links plus the page link, all of which resolve. `site/index.html` 1,019 lines, 23 sections (new: `#stdio`, `#scope`, `#more-docs`, each in the sidebar), plus reference text added to the existing `<details>` blocks of `#seeing-the-page`, `#several-sessions`, `#networking`, `#real-sizes-and-typing`, `#debugging-and-tabs` and `#reports`. Old README against README + site: 177 of 177 backticked tokens present.

**DELTA**: The README is 79% shorter by lines (207 → 44) and 82% shorter by characters (21,087 → 3,800). It now opens with the problem and the reasons to use the repo, then Quick Start, and links to the guide. Every detail that was in the README is on the index page; none was dropped.

**WITNESS**: Supervisor, 2026-11-12; `npm test` 383/383, the anchor run and the fact check executed by the Supervisor against e0da797; implementer: frontend-developer on `worktree-agent-a3e0f3112cb7ec47c`.
