# TASK_GUIDE — T035: Docs and docs-site index page catch up with T029–T034
**Date**: 2026-11-10
**Risk Level**: Low (docs and the static docs page only; no `src/` change)
**Assigned agents**: frontend-developer

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `memory/MEMORY.md`, `README.md` and this guide instead.)

## Requirement
User, 2026-11-10: "let update the docs and index page if any for these update" — after T029–T034 landed on main (4de8561). Tool lists and counts (26) are already right everywhere; the how-to prose is not.

Gaps found by the Supervisor audit:
1. `site/index.html` (the Vercel docs page) has guide sections for sessions, labels, selectors, verify-vs-wait, reports — but none for: seeing the page (T030: `state`, `overlays`, `focused`, custom widgets, `ui_get_text`), closing overlays + answering native dialogs (T031: `ui_click_outside`, `ui_click` options, `ui_dialog`, held dialogs, `DIALOG_TIMEOUT_MS`), real sizes (T032: session `viewport`/`device`/`colorScheme`/`locale`/`timezoneId`, `ui_set_viewport`, `ui_type`, `ui_navigate_history`, panel scroll, screenshot `selector`/`fullPage`/`inline` within 1280×8000), debugging and multi-page (T033: `ui_get_logs`, HTTP errors, `ui_tabs`, `ui_upload_file` with the built-in `default_draft.png`, `ui_drag`, downloads under `reports/downloads/<session>/`, 25 MB / 20-per-session caps).
2. `README.md` has sections for T029, T031, T030 (inside "Use the selector"), T032 — but T033 is one sentence under "What the report shows". Add a short "Debug a flow and work across tabs" section.
3. `RUNBOOK.md`: add a **Configuration** table of the env vars the server reads (`DIALOG_TIMEOUT_MS`, `SESSION_TIMEOUT_MS`, `MAX_SESSIONS_PER_CONNECTION`, `FAILURE_SCREENSHOT_BUDGET` — take defaults/meaning from `src/`); add failure-mode rows (calls refused with "A … dialog is waiting" → answer with `ui_dialog`; "Session limit reached" → end a session or raise the cap; `reports/downloads/` growing → caps, clean up); add a Release Log row for 2026-11-10, scope T029–T034, main @ 4de8561, outcome "merged + pushed; container rebuild not yet verified".
4. `HARNESS.md`: one note that REST `/api/run-test` sessions auto-dismiss native dialogs (they cannot be answered) and that REST behaviour is otherwise unchanged.
5. `PROJECT_SPEC.md` Memory/Insights table: one row for 2026-11-10 summarising T029–T034 (multi-session + 4 browser-action slices, 26 tools; integrated by merge, not rebase).

## Acceptance Criteria
- [ ] `site/index.html` has four new guide sections (one per T030–T033 theme) with the same voice/markup/classes as the existing sections, each with a short example call; each is reachable from the sidebar nav; nothing else on the page changes.
- [ ] `README.md` has a T033 section; existing sections untouched except to link to it if natural.
- [ ] `RUNBOOK.md` has the Configuration table (values verified against `src/`), the 3 failure-mode rows, and the Release Log row.
- [ ] `HARNESS.md` has the REST dialog note.
- [ ] `PROJECT_SPEC.md` Memory/Insights has the 2026-11-10 row.
- [ ] Every fact written is checked against the code on main (tool names, option names, defaults, limits) — no invented options.
- [ ] `test/site.test.ts` and `test/docs-tools.test.ts` pass; full `npm test` 0 failures.
- [ ] Site at 375px and 1280px: no horizontal overflow, new sections readable (UX check).

## Approach
Mirror the README wording where it exists; write the T033 prose fresh from `src/server.ts` tool descriptions and `src/tools/session.ts` limits. Keep sections short (a paragraph + one example each).

## Files to change (predicted)
| File | Change |
|------|--------|
| `site/index.html` | 4 guide sections + sidebar links |
| `README.md` | T033 section |
| `RUNBOOK.md` | Configuration table, failure modes, release log row |
| `HARNESS.md` | REST dialog note |
| `PROJECT_SPEC.md` | Memory/Insights row |

## Files must NOT touch
| File | Reason |
|------|--------|
| `src/**`, `test/**` (except adding a site test if useful) | docs-only task |
| AGENTS.md, CLAUDE.md, harness files | kit-owned |

## Test plan
`node --import tsx --test test/site.test.ts test/docs-tools.test.ts`, then full `npm test`; headless screenshots of `site/index.html` at 375px and 1280px.

## Verification Command
```
node --import tsx --test test/site.test.ts test/docs-tools.test.ts && npm test
```

## Completion checklist
- [ ] Implementation done
- [ ] Tests pass
- [ ] UX check at 375/1280 done
- [ ] TASK_GUIDE marked complete
