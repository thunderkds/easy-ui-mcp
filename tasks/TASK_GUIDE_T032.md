# TASK_GUIDE — T032: Real users, real sizes — viewport, device, typing, history, panel scroll, screenshots
**Date**: 2026-11-10
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P1 (viewport is P0)
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `memory/codebase-map.md` if present
7. Read `BRAINSTORMING_LOG_browser-actions.md` — rows G1–G3, B2, E1, A9, F2, F3

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-11-10): check every action an agent needs, not only the examples given. The audit found:
- Every session uses `browser.newContext()` with defaults (`src/tools/session.ts:104`), so the viewport is fixed at 1280×720. Phone (375px) and tablet layouts can't be tested, and neither can mobile user agents, dark mode, locale or timezone.
- `ui_fill` sets a value in one go. Autocomplete, search-as-you-type, masked inputs and OTP boxes need real keystrokes.
- There's no back / forward / reload. Navigating again loses history and form state.
- `ui_scroll` only scrolls the page down or an element into view. It can't scroll inside a panel (chat, virtual table), sideways, or to the top.
- `ui_take_screenshot` captures the viewport only and returns a path, not an image the agent can look at.

**Restated intent**:
> The agent can test the app at the sizes and settings real users have, type like a user, move through browser history, scroll any scroll area, and see the screenshots it takes.

**Out of scope**:
- Touch gestures and tap/swipe (later)
- Auth reuse, network mocking, geolocation, clock (later)
- Visual diffing

**Requirement Refs**:
- FR-002a: `ui_start_session` (extended with context options)
- FR-003: `ui_take_screenshot` (extended)
- FR-024 (new, added by this task): viewport/device/colorScheme/locale/timezone, key-by-key typing, history navigation, container scroll, element/full-page/inline screenshots
- US-002, US-004

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed by the user (2026-11-10)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] FR-024 added to `PRD.md` and covered by the Acceptance Criteria

---

## Dependencies & Reachability

**Depends on**: none.
**Coordinate with**: T029 (multiple sessions). Context options are per session, which fits T029's per-session browser. New tools take the optional `session_id` if T029 has merged.

**Entry point**: MCP tools `ui_start_session`, `ui_set_viewport`, `ui_type`, `ui_navigate_history`, `ui_scroll`, `ui_take_screenshot`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `ui_start_session` accepts optional `viewport {width,height}`, `device` (a Playwright `devices` name, e.g. `"iPhone 13"`), `colorScheme` (`light`/`dark`), `locale`, `timezoneId`. Unknown device → `isError` listing a few valid names. Without options → today's behaviour | real sizes and settings |
| 2 | `device` sets viewport, user agent, `deviceScaleFactor`, `isMobile`, `hasTouch`; explicit `viewport` overrides the device's size | mobile emulation |
| 3 | `ui_set_viewport(width, height)` resizes the current page (320–3840 × 320–2160); the result tells the agent to re-read page state (`nth=` selectors may be stale) | resize mid-flow |
| 4 | The report header shows the session's viewport/device/colorScheme/locale when set | truthful report |
| 5 | `ui_type(selector, text, delayMs?)` types key by key into the single match (`pressSequentially`), firing `keydown`/`input` per character; `delayMs` 0–500, default 0. Report never stores the text when the target is `type=password` (shows `••••`) | type like a user |
| 6 | `ui_navigate_history(action: "back"|"forward"|"reload")` works on the current page; no history entry → `isError` that says so; result returns the new URL and title like `ui_navigate` | browser history |
| 7 | `ui_scroll` gains optional `container` (selector of a scroll area) and `direction` (`down`/`up`/`left`/`right`/`top`/`bottom`, default `down`); one viewport (or container) step per call. Existing calls behave as today | scroll any area |
| 8 | `ui_scroll` result says when the end was reached (no movement), so the agent stops looping on lazy lists | no endless loops |
| 9 | `ui_take_screenshot` gains `selector?` (element only), `fullPage?`, and `inline?`. With `inline: true` it also returns the PNG as MCP `image` content, scaled down to ≤ 1280px wide | see screenshots |
| 10 | Screenshot dedupe/budget (NFR-008, T013) still applies; inline images are not written twice | report stays small |
| 11 | Docs updated; the doc-drift test passes | agent guidance |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Session with `viewport 375×812`, `colorScheme dark` on a fixture that prints `innerWidth` and `matchMedia('(prefers-color-scheme: dark)')` | 375 and true | `test/session.test.ts` |
| 2 | Session with `device "iPhone 13"` | mobile UA, `ontouchstart` present | `test/session.test.ts` |
| 3 | Fixture counting `input` events; `ui_type("#q","abc")` vs `ui_fill` | 3 events vs 1 | `test/web.test.ts` |
| 4 | Navigate A → B, back, forward, reload; back at the first page | URLs match; first-page back is `isError` | `test/web.test.ts` |
| 5 | Fixture with a 300px overflow panel and a horizontal carousel | container scrollTop/scrollLeft move; end-reached reported | `test/web.test.ts` |
| 6 | `ui_take_screenshot {selector, inline:true}` | element-sized PNG on disk + image content in the response | `test/web.test.ts` |
| 7 | `describe()` for new tools/options | readable, escaped, password masked | `test/reports.test.ts` |
| 8 | Live: rebuilt container, Claude Code opens the docs site at 375px and 1280px and views both screenshots inline | menu button visible only at 375 (T027) | Stage 5 `verify` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts && node --import tsx --test test/session.test.ts && node --import tsx --test test/reports.test.ts && node --import tsx --test test/docs-tools.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T032.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T032.md`.

---

## Approach

**Brainstorming**: done — `BRAINSTORMING_LOG_browser-actions.md`, Option B, approved 2026-11-10.

**Pattern reference**:
- `startSession()` in `src/tools/session.ts:101`: pass options into `browser.newContext({...devices[name], viewport, colorScheme, locale, timezoneId})`.
- New tools use `runInteraction` + `onUniqueLocator` (T019).
- `scroll()` in `src/tools/web.ts:184` is the base to extend.

**Vital slice**: context options + `ui_set_viewport`; `ui_type`; `ui_navigate_history`; `ui_scroll` container/direction; screenshot options.
**Cut list**:
- Saved viewport presets
- Per-call screenshot quality/format
- Touch gestures

---

## Edge Case Checklist

- [ ] Legacy no-session page: `ui_set_viewport` works; context options are session-only (documented)
- [ ] `fullPage` on a very tall page → height capped (e.g. 16 000px) to protect report size
- [ ] Inline image size bounded; never base64 a full-page capture without scaling
- [ ] `ui_type` on a non-editable element → Playwright error passed through
- [ ] `reload` on a page with a `beforeunload` guard → handled by T031's dialog rule (if merged) or Playwright default
- [ ] `ui_scroll` container that isn't scrollable → ok with "nothing to scroll"
- [ ] `back` that leaves the origin → allowed, URL reported

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/session.ts` | context options on `startSession`, stored on the session for the report |
| `src/tools/web.ts` | `typeText()`, `navigateHistory()`, `scroll()` options, `takeScreenshot()` options |
| `src/server.ts` | new tools via `TOOL`, schema options on `ui_start_session` / `ui_scroll` / `ui_take_screenshot` |
| `src/reports/index.ts` | `describe()` cases + session settings in header |
| `test/web.test.ts`, `test/session.test.ts`, `test/reports.test.ts`, `test/docs-tools.test.ts` | AC tests |
| `PRD.md` | FR-024 |
| `AGENTS.md`, `HARNESS.md`, `README.md`, `RUNBOOK.md`, `site/index.html` | tool list + count |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `isFatalOutcome` | verdict semantics |
| screenshot dedupe logic (T013) | reuse, don't rewrite |
| `src/api/run-test.ts` | REST shape unchanged (viewport there is a later task) |

---

## Test Plan

Test-first per AC with `setContent` fixtures and two local fixture pages for history. Run the verification command, then a live drive on a spare port and on the rebuilt container.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T032.md`
- [ ] Security review run (Medium risk) — password text never stored by `ui_type`
- [ ] Docs updated (AC 11), FR-024 in `PRD.md`
- [ ] Supervisor notified: task ready for Stage 4 review
