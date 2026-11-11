# BRAINSTORMING_LOG — Low-token page state (compact snapshot + refs)
**Generated**: 2026-11-11
**Task / Context**: T040 (compact snapshot + refs), T041 (tool-description trim). Risk: Medium — changes the reply contract of `ui_get_page_state`.
**Skill**: `Skill({ skill: "brainstorming" })` · **Tier**: Standard
**Evidence**: `docs/experiments/token-baseline-2026-11-11.md`

---

## The Problem Space

`ui_get_page_state` returns JSON in which each element carries a verified Playwright selector. On link-heavy pages the selectors and JSON keys are most of the reply: 4,000–13,400 tokens per snapshot, against 1,000–1,600 for one line per element with a short ref. On app-style pages the snapshot is already small (69–582 tokens) and the fixed tool list (6,705 tokens) dominates.

Non-negotiable:
- Sessions, step labels, assert/check/wait semantics and HTML/JSON reports stay as they are.
- A ref must never act on a different element than the one the agent saw. A stale ref fails; it does not guess.
- Reports stay readable: they show the resolved selector, never a bare `@e7`.
- CSS and Playwright selectors keep working everywhere (unnamed elements are not listed, so refs cannot replace them).
- The server never changes the page under test (no injected attributes).

Verified against the code:
- All selector-taking tools register through `registerSessionTool` (`src/server.ts:231`), which already wraps every handler. That is one place to translate a ref before the handler runs.
- `getPageState` (`src/tools/web.ts:929`) already holds an `ElementHandle` for every listed element and builds a selector verified by identity (`buildSelector`, `web.ts:850`).
- `ui_assert`, `ui_check` and `ui_wait_for` take a JS condition, not a selector; refs do not apply to them.
- Tests that call `getPageState()` directly read the struct; tests and docs that read the tool's JSON reply are `test/web.test.ts`, `test/multi-session.test.ts`, `test/dialog-sessions.test.ts`, `test/site.test.ts`, `README.md`, `RUNBOOK.md`, `site/index.html`, `PROJECT_SPEC.md`.

---

## Questions for the User

Answered by the user on 2026-11-11 ("yes, as your suggestion", and "move on, do not wait"):
1. Default format → compact, with `format: "full"` shipped in the same task.
2. Ref lifetime → invalidated by every new snapshot.
3. Viewport-only / `within` scope → follow-up, not in this task.

Decided by the Supervisor (reversible, say so if you disagree):
4. `format: "full"` returns exactly today's JSON, with no ref field added, so existing callers only add one argument.
5. Overlays get refs too (`@o1`), because `ui_click_outside` takes their selector.

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | Alias refs with identity check | A ref maps to the verified selector the server already builds, plus the element handle; resolved in `registerSessionTool` before the handler | Low–Medium | ~200 lines + tests | Low | ✅ Yes |
| B | Handle-native refs | Actions run on the stored `ElementHandle`; no selector is built for refs | High | ~450 lines + tests | High | |
| C | No refs, derivable selectors | Compact lines only; the agent composes `role=button[name="…"]` itself, a selector is printed only when that would not be unique | Low | ~90 lines + tests | Medium | |

### Option A — Alias refs with identity check
**Approach**: `getPageState` stays as it is and keeps returning the struct. A new `renderCompact(state)` prints one line per element. Per page, a map `ref → {selector, handle, role, name}` is stored (WeakMap keyed by `Page`) and replaced on every snapshot; the previous handles are disposed. In `registerSessionTool`, any `selector` / `from` / `to` / `container` argument shaped `@e12` or `@o1` is resolved to its selector before the handler runs. Resolution checks that the selector still matches exactly one element and that it is the stored handle; otherwise the call fails with "stale ref, call ui_get_page_state again". Handlers, `recordAction` and reports then see a normal selector.
**Pros**: handlers and `web.ts` actions unchanged; reports readable with no report change; exact binding without touching the page; works per session and per tab because the map is per `Page`.
**Cons**: snapshot time is unchanged (selectors are still built); the reply echo still prints the resolved selector (about 15 tokens per action).
**Why it might fail**: a page that re-renders the same widget (new DOM node, same look) makes every ref stale and forces a re-snapshot per action. That is correct but could cost more calls on highly dynamic apps. Mitigation: the error text says exactly what to do, and CSS selectors remain available.

### Option B — Handle-native refs
**Approach**: keep handles, act on `handle.click()` etc., skip `buildSelector` for refs.
**Pros**: faster snapshots on big pages; binding is exact by construction.
**Cons**: about 12 action functions in `web.ts` take a selector string and go through `resolveUniqueLocator`; all need a second code path. Reports and echoes need a separately built description. Handle lifetime must be managed across tabs and sessions.
**Why it might fail**: two code paths for every action double the surface for the bugs T029–T033 just closed (dialogs, tabs, downloads), for a speed gain nobody asked for.

### Option C — No refs, derivable selectors
**Approach**: print `role "name"`; the agent writes the role selector itself.
**Pros**: least code, no server state, nothing can go stale.
**Cons**: request tokens go up; quoting names is error-prone; up to 138 of 200 elements on one measured page share role and name, so most lines would still need an explicit `nth` selector.
**Why it might fail**: it moves selector construction, the thing T018 took away from the agent because it failed, back to the agent.

---

## 50% Rule Check

Option A at half the code: drop the identity check and make the ref a plain alias for the selector string. That removes handle storage and disposal (~60 lines). Rejected: a positional `nth=` selector can silently point at a different element after the list changes, which is the one failure the user ruled out. The check is the part that must stay; what is cut instead is everything in "Cut list" below.

---

## Recommended Path

**Option A — Alias refs with identity check**

It reaches the measured saving (1.7× on app flows, about 5× on link-heavy flows) by adding a rendering function and one resolution step, and leaves every action handler, the session recorder and the report writer untouched.

Compact reply shape:
```
url: https://www.saucedemo.com/inventory.html
title: Swag Labs
@e1 button "Open Menu"
@e2 combobox "Name (A to Z)" value="az"
@e3 button "Add to cart"
overlay @o1 dialog "Confirm" modal
focused: @e2
messages: "Saved"
note: Showing first 200 of 512 elements; use a CSS selector for the rest
```

**Next Actions**
1. T040 — compact snapshot + refs + `format: "full"`; docs and doc-pinning tests updated in the same task.
2. T041 — trim tool descriptions (after T040, same file); target and method set in its own guide.
3. Follow-ups on the board, not planned yet: viewport-only / `within` scope; empty snapshot straight after a navigating click (bug).

**Cut list** (not built): `{"ok":true}` replies; tool grouping; ref echo in action replies; refs inside `format: "full"`; faster snapshots.

---

## Surgical Scope

Files that **should** be touched:
- `src/tools/web.ts` — `renderCompact`, per-page ref map, `resolveRef`
- `src/server.ts` — `format` parameter on `ui_get_page_state`; ref resolution in `registerSessionTool`; selector descriptions mention refs
- `test/web.test.ts` (+ a ref test in `test/multi-session.test.ts`) — compact format, ref resolution, stale ref, per-session isolation
- `test/dialog-sessions.test.ts`, `test/multi-session.test.ts`, `test/site.test.ts` — only where they read the JSON reply
- `README.md`, `RUNBOOK.md`, `site/index.html`, `PROJECT_SPEC.md` — describe the new default

Files that **must not** be touched:
- `src/tools/session.ts`, `src/reports/index.ts` — recorder and reports see resolved selectors; no change needed
- `src/api/run-test.ts`, `src/stdio.ts` — unrelated transports
- The action functions in `web.ts` (`click`, `fill`, …) and `buildSelector` — behaviour must stay identical
- `docs/experiments/token-baseline.mts` — it is the measuring stick for the "after" run

---

## Edge Case Checklist for TASK_GUIDE

- [ ] One documented rule: a ref always means the latest snapshot of that page. After a new snapshot, `@eN` resolves against the new list or fails; it never reaches an element of the old list.
- [ ] A ref used after navigation or after its element is removed/re-rendered fails with a message that tells the agent to call `ui_get_page_state` again.
- [ ] A ref used before any snapshot, or an unknown number (`@e999`), fails clearly.
- [ ] Refs are per page: session A's `@e1` never resolves in session B; a new tab has its own map.
- [ ] `ui_drag` with `from` and `to` both refs; `ui_scroll` with `container` as a ref; `ui_press_key` with an optional selector ref.
- [ ] A CSS selector that happens to start with `@` is not a valid selector, so only the exact pattern `@e<digits>` / `@o<digits>` is treated as a ref.
- [ ] The report and the action log show the resolved selector, and the reply does not leak a typed value it did not leak before.
- [ ] Names containing quotes or newlines render on one line (JSON string escaping) and cannot forge an extra `@eN` line.
- [ ] A password value is still never printed; `value` is still cut at 100 characters and names at 80.
- [ ] `format: "full"` output is byte-for-byte today's JSON for the same page.
- [ ] Old handles are disposed when a new snapshot replaces the map and when the page closes (no handle leak over a long session).
- [ ] A held native dialog still blocks `ui_get_page_state` exactly as before (T031 guard order unchanged).
- [ ] Elements dropped because their selector could not be verified do not leave a gap that shifts later refs onto the wrong element.
