# TASK_REVIEW — T018: [Short Title]

> Sibling of `tasks/TASK_GUIDE_T018.md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | pass | `test/web.test.ts` — 11 new T018 tests (AC1-AC4, AC6, success criteria 1+2, duplicate id/testid, quote/backslash escaping, hostile-content injection, substring names, positional fallback, invisible/unnamed gaps, 500-element cap/perf). Red before the change (11 fail / 27 pass against HEAD's web.ts), green after. AC5 is description text in `src/server.ts` (no behavioural test; see diff). |
| Verification command run | pass | 2026-10-30 07:24:04Z: `node --import tsx --test test/web.test.ts && npx tsc --noEmit` -> `ℹ tests 38 / ℹ pass 38 / ℹ fail 0`, `TSC-OK` (tsc silent). Also `test/session.test.ts test/reports.test.ts` -> `ℹ tests 46 / ℹ pass 46 / ℹ fail 0`. |
| Negative cases hold | pass | duplicate id and duplicate data-testid are rejected (fall through); names/test ids with `"`, `\`, `'`; hostile name `x"] >> text=Pay >> nth=0 >> [name="y`, hostile id `a" ] , button`, hostile testid, role attribute `button]x` -> every selector counts 1 and clicks the intended element (observable `document.title`); names truncated at 80 chars (role selector cannot match) fall back to positional and still work; `getPageState(undefined)` unchanged. |
| verify | pass | Re-ran the Demonstration script against real headless Chromium after the change (07:24:21Z): every element now carries a `selector`, the two Delete buttons are `... >> nth=0` / `>> nth=1`. Click/fill round-trips are asserted in the automated tests (pass). Live MCP drive against the Docker container not done (port 8765 is the user's running container). |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | pass | `getPageState` and new helpers in `src/tools/web.ts`; description strings in `src/server.ts` (ui_click, ui_fill, ui_get_page_state); `src/reports/index.ts` describe case reads no element fields, not touched. |
| Full smoke suite still green (no regression) | pass (unit) | web 38/38, session + reports 46/46. `test/api-run-test.test.ts` / `test/health.test.ts` not run (they bind port 8765, owned by the user's container, known pre-existing collision). |
| **UI: Visual regression (diff or verdict pasted)** | N/A | backend-only task, no UI surface |
| **UI: Design-system compliance (tokens/colors/typography verified)** | N/A | backend-only task, no UI surface |
| **UI: Responsiveness at target viewports** | N/A | backend-only task, no UI surface |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured before any implementation commit; unmodified code at HEAD fac59b2):

```
$ date -u
Fri Oct 30 07:21:18 AM UTC 2026
$ node --import tsx demo.mts   # setContent(2x Delete, data-testid=save, input#a:b placeholder=Name, link Help "me"); console.log(JSON.stringify(await getPageState(page)))
{"ok":true,"url":"about:blank","title":"","elements":[{"role":"button","name":"Delete"},{"role":"button","name":"Delete"},{"role":"button","name":"Save"},{"role":"textbox","name":"Name"},{"role":"link","name":"Help \"me\""}],"messages":[]}
```

No element has a `selector` field, and the two `Delete` buttons are indistinguishable.

**AFTER** (same script, same fixture, after the change):

```
$ date -u
Fri Oct 30 07:24:21 AM UTC 2026
$ node --import tsx demo.mts
{"ok":true,"url":"about:blank","title":"","elements":[{"role":"button","name":"Delete","selector":"role=button[name=\"Delete\"] >> nth=0"},{"role":"button","name":"Delete","selector":"role=button[name=\"Delete\"] >> nth=1"},{"role":"button","name":"Save","selector":"[data-testid=\"save\"]"},{"role":"textbox","name":"Name","selector":"#a\\:b"},{"role":"link","name":"Help \"me\"","selector":"role=link[name=\"Help \\\"me\\\"\"]"}],"messages":[]}
```

**DELTA**: An agent can now pass an element's `selector` from `ui_get_page_state` unchanged to `ui_click`/`ui_fill` and hit exactly that element, including one of several identically named buttons, instead of guessing CSS.

**WITNESS**: Implementing agent (backend-developer) 2026-10-30 07:24Z; to be re-run by the Supervisor.

---

## Notes

- **Security reasoning (Medium risk)**: selector strings are built from page-controlled text (data-testid, id, role attribute, accessible name). They flow only into `page.locator()` / `locator.evaluateAll()` in Playwright, never into `page.evaluate` code strings, shell, or file paths. Three layers keep a selector from targeting a different element: (1) quoting: `\` and `"` (and CR/LF/FF) are escaped in quoted strings, and ids go through a CSS.escape port; (2) the role token from the page's `role` attribute is only used if it matches `^[a-z][a-z0-9-]*$`, otherwise the role strategy is skipped; (3) every candidate, including the positional fallback, is verified on the live page by element identity (`count === 1` and the single match is the same element handle), so any escaping gap or Chromium-vs-helper name mismatch causes a fall-through, not a wrong target. A candidate that fails to parse counts as no match. If no candidate verifies (element vanished mid-read) the element is omitted rather than given an unverified selector.
- **Staleness**: selectors are verified at read time only; `nth=` ones are positional and go stale when the DOM changes. Tool descriptions say so (AC5).
- **Design choice**: `getPageState` now collects `ElementHandle`s (`page.$$`) and passes them to a single `page.evaluate`, instead of `$$eval`, so identity checks are exact with no race between collection and verification. Elements with a duplicated role+name share one page round-trip (500 identical buttons: ~1.2s; 500 unique: ~1.1s; 500 with ids: ~0.35s, capped at 200 shown).
- **Truncation note**: new optional `note` field on `PageState` ("Showing first 200 of N elements; ..."), absent when not truncated.
- **Cut list**: stable refs, XPath, `text=` selectors, iframe elements, shadow-DOM elements (not returned at all).
