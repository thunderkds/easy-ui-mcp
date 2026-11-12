# BRAINSTORMING LOG — T046: simpler README, detail guide on the index page
**Date**: 2026-11-12 · **Tier**: Standard · **Risk**: Medium (README + site/index.html + test/site.test.ts)

## Problem space
User: make the README simpler. Say which problem it solves and why to use it. The detailed guide belongs on the index page (`site/index.html`).
Today the README is 207 lines. Lines 43–207 ("How it works in detail") repeat what the site already has.

## Verified facts (grep, 2026-11-12)
- Site already has: Why Easy UI, How it works, A session, Quick start, Use from another repo, Networking, Writing a flow (assert/check/wait_for table), Several sessions, Tools, Seeing the page, Dialogs, Real sizes, Debugging and tabs, Reports, REST wrapper, Measured, Troubleshooting, Development.
- Site gaps: stdio/`mcp-proxy` setup (one line only, no `mcp-proxy -- node dist/stdio.js`), Scope (v1) / Android on hold, links to AGENTS.md, HARNESS.md, RUNBOOK.md, PRD.md.
- No file links into README anchors (grep over md/html/ts, excluding tasks/memory), so removing sections breaks no link.
- Tests tied to README: `test/docs-tools.test.ts` (README must name every registered tool in backticks, and `session_id`); `test/site.test.ts` T039 (positioning line, Highlights / Quick Start / "How it works in detail" order, `### Tools` `### Networking` `### Scope (v1)` `#### What the report shows` headings, exactly two top-level parts); T025 AC10 (README links `site/index.html`).
- README is also the GitHub / package landing page, so links to the guide must be absolute (`https://easy-ui-mcp.vercel.app/#section`), not `site/index.html#x`.

## Alternatives
| | A. Short README, tool list kept | B. Pointer-only README | C. Keep two parts, shrink detail to a link list |
|---|---|---|---|
| Shape | Problem, why (6 rows), Quick Start, one-line tool list, 3-line stdio note, links to the guide and the other docs. About 45 lines | Problem, why, Quick Start, one link. About 25 lines | Highlights as now, detail replaced by a table of contents pointing at site sections. About 70 lines |
| Invasiveness | Medium | Medium | Low |
| Tests | Rewrite the T039 README assertions. Doc-drift test passes unchanged | Also move the doc-drift guard for tool names from README to the site | Edit the T039 assertions for the headings |
| Risk | README and site must stay in step by hand | A reader of the README alone sees no tool names, and the drift guard no longer covers the README | Still looks long, which misses the user's goal |
| 50% less code | Already about 78% shorter | Even shorter | Only about 65% shorter |
| Fails if | Someone adds a tool and only edits the site (the test catches it) | The site goes down and the README says nothing concrete | The user reads it and says "still too long" |

## Adversarial review
- **A**: the one-line tool list is the only duplicated fact left. It is guarded by the doc-drift test, so drift fails CI.
- **B**: it satisfies "simple" best but removes the cheapest honest check that the docs name every tool.
- **C**: it is a half-measure and keeps a second heading level the user did not ask for.

## Edge cases for the TASK_GUIDE
1. Absolute guide links on GitHub and npm (relative `site/` links do not resolve there).
2. Move the three gaps onto the site before deleting them from the README, so no fact is lost: stdio setup, Scope v1, links to AGENTS/HARNESS/RUNBOOK/PRD.
3. `session_id` must still appear in the README (docs-tools T029) and the site.
4. Keep the exact positioning line (T039) and the `site/index.html` link (T025 AC10).
5. Site test T025 facts (commands and numbers) read the site, not the README, so adding the stdio section must not break its assertions.
6. The site must still pass its landmark and button checks (T025 AC5/AC7) after the new sections are added.
7. Do not reword facts when moving them. Move the text, then run the full `npm test`.

## Surgical scope
Change: `README.md`, `site/index.html` (add a stdio section and a Scope note, plus a nav entry if the sidebar lists sections), `test/site.test.ts` (T039 README assertions), `PROJECT_KANBAN.md`.
Do not touch: `src/**`, `RUNBOOK.md`, `AGENTS.md`, `HARNESS.md`, `PRD.md`, `docs/experiments/**`.

## Recommended path
**A.** It meets "simple", keeps the one cheap drift guard, and the detail lives in one place, the index page.

## Open question for the user
See the message to the user.
