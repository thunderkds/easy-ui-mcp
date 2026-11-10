# TASK_GUIDE — T036: Docs-site index page in the Easy Kit family style, with flows and charts
**Date**: 2026-11-10
**Risk Level**: Low (static `site/index.html` + `test/site.test.ts`; no `src/` change)
**Assigned agents**: frontend-developer

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `memory/MEMORY.md`, `README.md`, `site/index.html` and this guide instead.)

## Requirement
User, 2026-11-10: "from the index page, let update it for more visualized, cause currently, it looks more the context, and detail text. Update for flow, chart, visualize the information will make the page catched better. Btw, the link to easy-kit is wrong, it should be https://easy-kits.vercel.app/. and the style is not the same with another page, let check the family" — https://easy-kits.vercel.app/, https://easy-verifier.vercel.app/, https://easy-memory.vercel.app/, https://easy-personal.vercel.app/.

Saved copies of the family pages (HTML + 1280px screenshots) for reference: `/tmp/claude-1000/-home-thunderkds-workspace-pets-easy-ui-mcp/c86cffca-b22c-4dae-8f06-040faf2e4df5/scratchpad/family/` (`easy-memory.html` and `easy-verifier.html` are the closest docs-page siblings; `easy-kits-full.png` shows the flow/journey idiom).

Family pattern (what to match):
- Fonts: IBM Plex Sans 400/500/600/700 + IBM Plex Mono 400/500 from Google Fonts (exact `<link>` as in easy-memory.html).
- Header: rounded-square icon tile in the accent outline + Title-Case product name ("Easy UI") + a small mono chip (e.g. `ui testing · mcp server`); family nav (dot + name, current one lit); **GitHub as a bordered button**.
- Sidebar: `// overview`, `// guide`, `// reference` groups; active item as an outlined pill.
- Hero: green mono `> tagline`, large title "Easy UI", a lead paragraph, a primary accent button + a secondary bordered button, then a 3-column feature-tile row.
- Body: visual first — flow diagrams of boxed nodes + arrows (HTML/CSS or inline SVG), before/after comparisons, horizontal bar charts from measured numbers, chip grids; long prose folded under a "More detail" `<details>` per section.

## Acceptance Criteria
- [ ] Easy Kit link is `https://easy-kits.vercel.app/` everywhere on the page (header + phone sidebar); no `personal-agentic-claude` left.
- [ ] Header, fonts, sidebar, hero, buttons and tiles follow the family pattern above, using the existing Graphite Mint tokens on `:root` (raw hex only inside `:root`, as the current tests require).
- [ ] At least these visuals, all built from real facts in the repo (no invented numbers):
  1. **How it works** flow: Claude Code → MCP over HTTP (`localhost:8765/mcp`) → easy-ui-mcp in Docker → Playwright Chromium → page under test; and the return path → JSON + HTML report in `reports/`.
  2. **A session** flow: `ui_start_session` → `ui_navigate` → `ui_get_page_state` → act (`ui_click`/`ui_fill`/…) → check (`ui_check`/`ui_assert`/`ui_wait_for`) → `ui_end_session` → report.
  3. **Tools map**: the 26 tools as a chip grid grouped by job (session, navigate, read the page, act, check/wait, dialogs & overlays, tabs/files/logs, sizes) — names taken from `src/server.ts`.
  4. **Before / after** comparison for the agent's view (e.g. guessing CSS selectors vs. using the verified selector from page state; or a native dialog that used to hang vs. `ui_dialog`).
  5. **Measured** bar chart(s) from recorded numbers only, e.g. report size 357 KB → 4 KB (T013, `memory/learnings.md`), click wait ~33 ms (plain element) vs ~185 ms (likely opener) (T033 re-verify), test suite 303 tests.
  6. **Several sessions** diagram (one MCP connection → up to 3 sessions, each with its own browser/report; idle close after 10 min).
- [ ] All existing content stays reachable (sections may be reordered/merged; dense text moves into "More detail"). Every section id the sidebar links to exists; the 26-tool count and every tool name still appear; the four T035 sections' key facts stay.
- [ ] Existing behaviours kept: family nav in the header from 900px and in the sidebar below (T026); the phone Menu button folds the sidebar below 720px, `aria-expanded` tracks it, no-JS keeps it open (T027); header lines up with the centered column on desktop (T028).
- [ ] `test/site.test.ts` updated to the new structure (keep the behavioural assertions above; add: Easy Kit URL, IBM Plex link, presence of the flow/chart blocks), and `test/docs-tools.test.ts` passes; full `npm test` 0 failures.
- [ ] Visual check with headless Chromium at 375px, 720px, 1280px and 1920px: no page-level horizontal overflow, diagrams readable (stack vertically on phones), nothing clipped; compare side by side with the easy-memory screenshot and note any remaining style differences.
- [ ] Accessible: diagrams have text equivalents (real text nodes or `aria-label`/`<title>`), colour is not the only signal, contrast holds in the dark theme.

## Approach
Rebuild `site/index.html` in place (single static file, inline CSS, the existing tiny inline script). Reuse the family's class idioms (flow nodes/arrows, tiles, chips, bars) with this page's own tokens. Prefer HTML/CSS flows (they reflow on phones) and inline SVG only where a shape needs it. No external JS, no build step (Vercel serves `site/` as-is).

## Files to change (predicted)
| File | Change |
|------|--------|
| `site/index.html` | family header/fonts/hero/tiles, visual sections, "More detail" folds, Easy Kit URL |
| `test/site.test.ts` | follow the new structure, keep behavioural checks |

## Files must NOT touch
| File | Reason |
|------|--------|
| `src/**`, other tests, `vercel.json` | page-only task |
| README.md, RUNBOOK.md | not part of this request |

## Test plan
`node --import tsx --test test/site.test.ts test/docs-tools.test.ts` red → green for the new assertions; full `npm test`; screenshots at 375/720/1280/1920 read and judged.

## Verification Command
```
node --import tsx --test test/site.test.ts test/docs-tools.test.ts && npm test
```

## Completion checklist
- [ ] Implementation done
- [ ] Tests pass
- [ ] UX check at 375/720/1280/1920 done
- [ ] TASK_GUIDE marked complete
