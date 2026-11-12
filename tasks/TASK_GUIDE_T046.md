# TASK_GUIDE — T046: Simpler README (problem, why, quick start); the detailed guide lives on the index page
**Date**: 2026-11-12
**Complexity Level**: C1
**Risk Level**: Medium (README + `site/index.html` + `test/site.test.ts`; two doc-drift tests read the README)
**Priority**: P1
**Assigned agent**: frontend-developer (implement; docs text and site HTML)
**Agent guide**: `agents/frontend.md`

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `BRAINSTORMING_LOG_T046-readme-simple.md` and this guide.)

---

## Mandatory Startup (Do Not Skip)

1. Read `PROJECT_SPEC.md`
2. Read this file completely
3. Read `agents/frontend.md`
4. Read `BRAINSTORMING_LOG_T046-readme-simple.md` (Path A is the chosen path; the user confirmed it on 2026-11-12)
5. Read `README.md`, `site/index.html`, `test/docs-tools.test.ts` and `test/site.test.ts`

---

## Requirement

User, 2026-11-12: "from the README, I wanna make it more simple. Focusing which problem solving, why user should use our repos, the detail guide should in the index page". User confirmed Path A: keep a one-line list of tool names in the README.

**Restated intent**:
> `README.md` is short and says three things: the problem this solves, why to use it, and how to start. Everything that explains how to use it in detail is on the docs index page (`site/index.html`), and the README links to it. No fact is lost: whatever the README drops either is already on the site or moves there.

**Out of scope**: changing any fact or number; `src/**`; the other docs (`RUNBOOK.md`, `AGENTS.md`, `HARNESS.md`, `PRD.md`); restyling the site.

**Cut list** (not doing): rewriting the site's existing sections, a second README for npm, a docs-site search.

---

### Requirement Fidelity Gate

- [x] Restated intent confirmed by the user (Path A)
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] No new PRD requirement (documentation only)

---

## Dependencies & Reachability

**Depends on**: T039, T044 (README positioning and layout), T045 (site and README currently in sync)

**Entry point**: `README.md` (GitHub landing page) and `site/index.html` (https://easy-ui-mcp.vercel.app/)

---

## Acceptance Criteria

- [x] `README.md` is at most 60 lines.
- [x] It opens with the positioning line, unchanged: "local UI-testing MCP that gives your agent structured, shareable test reports".
- [x] It states the problem first (what goes wrong with plain browser automation for testing), then why to use this repo (the six points, one short row each), then Quick Start (build, health check, `claude mcp add`).
- [x] It keeps one line naming all registered tools in backticks, and mentions `session_id` once (for the doc-drift tests).
- [x] It has a short stdio note (`dist/stdio.js`, run via `mcp-proxy -- node dist/stdio.js`) that links to the site section.
- [x] Every link from the README to the guide is an absolute `https://easy-ui-mcp.vercel.app/#<id>` URL whose id exists in `site/index.html`. The README still contains `site/index.html` once (T025 AC10: link to the site source).
- [x] The README links the other docs: `AGENTS.md`, `HARNESS.md`, `RUNBOOK.md`, `PRD.md`.
- [x] `site/index.html` gains the three pieces the README used to hold alone: a stdio section (build, start with `mcp-proxy`, one client per connection, exits when stdin closes), a Scope (v1) note (web and Chromium only, local only, Android on hold, no `android_*` tools), and links to AGENTS.md, HARNESS.md, RUNBOOK.md and PRD.md. The sidebar lists any new section. The new text is moved from the README, not reworded.
- [x] The facts the README removed are on the site (spot-check list in the Test Plan); none is dropped.
- [x] `test/site.test.ts` T039 README assertions describe the new README: positioning line, Quick Start, the six-point table, the line count ceiling, links to existing site ids. The old "two top-level parts" and "detail part holds ### Tools / ### Networking / ### Scope (v1)" assertions are replaced, not weakened silently.
- [x] Full `npm test` has 0 failures, with no other test edited.

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given | Expect | How it's checked |
|---|-------|--------|------------------|
| 1 | `README.md` | 60 lines or fewer; positioning line present | automated test (T039) |
| 2 | Every `https://easy-ui-mcp.vercel.app/#id` in the README | `id="…"` exists in `site/index.html` | automated test |
| 3 | `src/server.ts` registered tools | each named in backticks in the README; `session_id` present | `test/docs-tools.test.ts`, unedited |
| 4 | `site/index.html` | has the stdio section containing `mcp-proxy -- node dist/stdio.js`, the Scope note, and links to the four docs | automated test |
| 5 | The old README text (git `HEAD`) | every command, env var name and number from it appears on the site or in the new README | Supervisor spot-check, table in the Test Plan |
| 6 | The site | one `<h1>`, landmarks and button names intact (T025 AC5/AC7) | `test/site.test.ts`, unedited |
| 7 | All existing tests | pass | `npm test` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/site.test.ts test/docs-tools.test.ts && npm test
```
`npm test` needs port 8765 free (stop the Docker container first).

### Evidence (filled by reviewer at Stage 4/5)

> Filled by the reviewer in `tasks/TASK_REVIEW_T046.md`.

---

## Demonstration

> See `tasks/TASK_REVIEW_T046.md`. AFTER is the short README plus the extended site page.

**BEFORE** (measured 2026-11-12 on `main` at `7b24a59`, before any implementation commit): `README.md` is 207 lines, 3,198 words, 21,087 characters, 2 top-level parts, 13 subsections; the highlights part is lines 9–42 and the detail part is 165 lines (43–207). It names 26 tools. `site/index.html` is 976 lines with 20 sections; it has no `mcp-proxy` text, no Scope note, and no links to AGENTS.md, HARNESS.md, RUNBOOK.md or PRD.md.

---

## Approach

**Vital slice**: move the three missing pieces to the site first, then cut the README down to the short form, then update the T039 test.

1. Site: add a "Running over stdio" section after "Quick start" (or beside "Use from another repo"), a "Scope" note near the end, and the four doc links, each with a sidebar entry in the existing style. Copy the README text; do not reword.
2. README: keep the title and positioning line; replace the intro paragraph with the problem; keep the six rows shorter (one sentence each); keep Quick Start; add the one-line tool list, the stdio note and the links.
3. Test: replace the README structure assertions in the T039 test with the criteria above.
4. Compare the old README (`git show HEAD:README.md`) against the site: every command, env var and number must be findable.

## Edge Case Checklist

- [ ] Absolute guide URLs, not `site/index.html#x` (GitHub and npm cannot follow relative links to the site).
- [ ] No anchor into the old README remains in any file (grep showed none outside tasks/memory).
- [ ] `session_id` still appears in the README, the site and `HARNESS.md`.
- [ ] Tool count: the README line names every tool; `RUNBOOK.md` still says "all 26 tools".
- [ ] The site's "26 tools" tile and any numbers are not changed.
- [ ] Moving text from the README to the site keeps HTML escaping (`&lt;`, `&gt;`) and `<code>` styling consistent with neighbouring sections.
- [ ] Do not add a heading to the README that the new test forbids; do not use a second-level heading for detail.

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `README.md` | short form (problem, why, quick start, tool line, stdio note, links) |
| `site/index.html` | stdio section, Scope note, links to AGENTS/HARNESS/RUNBOOK/PRD, sidebar entries |
| `test/site.test.ts` | T039 README assertions rewritten; new assertions for the site additions |
| `PROJECT_KANBAN.md` | board row (Supervisor) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/**` | documentation only |
| `RUNBOOK.md`, `AGENTS.md`, `HARNESS.md`, `PRD.md`, `PROJECT_SPEC.md` | linked, not edited |
| `test/docs-tools.test.ts` | it must pass unedited (proves the README still names every tool) |
| `docs/experiments/**`, `vercel.json` | unrelated |
| `.claude/`, `skills/`, `agents/`, `scripts/` | harness |

## Test Plan

1. Write the new T039 assertions first; they fail on the current README (207 lines).
2. Make the site and README changes until they pass.
3. Run the verification command and the full `npm test`.
4. Spot-check table (Supervisor): `mcp-proxy -- node dist/stdio.js`, `MAX_SESSIONS_PER_CONNECTION`, `SESSION_TIMEOUT_MS`, `DIALOG_TIMEOUT_MS`, `FAILURE_SCREENSHOT_BUDGET`, `network_mode: host`, `host.docker.internal`, `default_draft.png`, `reports/downloads`, `capped at 500`, `viewport: true`, `within`, `Android`.

## Completion Checklist

- [x] Implementation done
- [x] Self-review: `Skill({ skill: "code-review" })` run
- [x] Security review: not required for a docs change; Supervisor confirms no secret or internal path was added
- [x] Tests written AND pass; output pasted into `tasks/TASK_REVIEW_T046.md`
- [x] `Skill({ skill: "verify" })` run: the site page renders and its new anchors work
- [x] `memory/MEMORY.md` updated if a new pattern was learned (Supervisor only)
- [x] Supervisor notified: task ready for Stage 4 review
