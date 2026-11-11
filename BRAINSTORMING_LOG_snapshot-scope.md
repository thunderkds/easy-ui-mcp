# BRAINSTORMING_LOG — Snapshot scope for content-heavy pages
**Generated**: 2026-11-11
**Task / Context**: T043. Risk: Medium — adds arguments to `ui_get_page_state` and filters what it lists.
**Skill**: `Skill({ skill: "brainstorming" })` · **Tier**: Standard
**Evidence**: `docs/experiments/token-baseline-2026-11-11.md`

---

## The Problem Space

After T040 a snapshot of an app-style page costs 28–254 tokens, but a link-heavy page still costs 1,000–1,600, because up to 200 elements are listed whether or not the agent can see or needs them. In the baseline, 37–71% of the listed elements were inside the 1280×720 viewport, and listing only those cut Wikipedia snapshots from 4,474 to 2,521 tokens and Hacker News from 5,113 to 2,891. One of 21 picked targets was off-screen.

Non-negotiable:
- The default reply does not change: an agent that passes nothing sees what it sees today.
- A scoped reply says that it is scoped and how many elements were left out, so an agent never mistakes it for the whole page.
- Refs keep their T040 rule: they mean the latest snapshot, scoped or not.
- The tool list stays within its 20,000-character budget (19,017 now).

Verified against the code:
- `getPageState` (`src/tools/web.ts`) reads every candidate's bounding rect in one `evaluate` pass before it caps the list at 200 and builds selectors. A scope test can be added to that pass and applied before the cap.
- The positional fallback selector (`INTERACTIVE_SELECTOR >> nth=i`) indexes the page-wide candidate list, so candidates must still be collected page-wide; scoping has to be a filter, not a narrower query.
- Ref arguments are resolved in `registerSessionTool` for the names in `REF_ARGUMENTS` (`selector`, `from`, `to`, `container`).

---

## Questions for the User

Decided by the Supervisor under the user's "continue to clean the pending tasks" (2026-11-11); say so if you disagree:
1. Scoping is opt-in, not a new default. ⚠ decided for you
2. Both scopes ship: `viewport: true` and `within: <selector or ref>`. ⚠ decided for you

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | Opt-in filters | `viewport: true` and `within` as optional arguments; a filter in the existing read pass; a note with the hidden count | Low | ~70 lines + tests | Low | ✅ Yes |
| B | Automatic viewport scope | Above a threshold (say 60 elements) list only the viewport by default | Medium | ~80 lines + tests | Medium–High | |
| C | Paging | `offset` / `limit` over the full list | Low | ~40 lines + tests | Low | |

### Option A — Opt-in filters
**Approach**: two optional arguments on `ui_get_page_state`. `viewport: true` keeps elements whose rect intersects the viewport. `within` takes a selector or ref of one element and keeps elements inside it (a dialog, a form, the main region). Both can be combined. The filter runs before the 200 cap, so a long page's cap applies to what is in scope. The reply carries `note: Showing 37 of 180 elements (viewport only); scroll, or call without viewport, for the rest`.
**Pros**: default untouched; smallest change; `within` also solves "what is inside this dialog" in one call; the cap stops hiding in-scope elements behind off-screen ones.
**Cons**: saves nothing unless the agent asks for it; costs about 250 characters of the tool-list headroom.
**Why it might fail**: agents may not discover the arguments. Mitigation: the existing 200-cap note names them, which is exactly when they matter.

### Option B — Automatic viewport scope
**Approach**: scope to the viewport by default on big pages.
**Pros**: saving without agent effort.
**Cons**: changes the default a second time in one day; an agent looking for a footer link gets a list without it and must learn to scroll; 1 of 21 baseline targets was off-screen.
**Why it might fail**: a missing element is a worse failure than a long list, and it would show up as flaky agent runs rather than as a test failure here.

### Option C — Paging
**Approach**: `offset` and `limit`.
**Pros**: trivial.
**Cons**: the agent pays for pages in document order to find one element; no relation to what a user sees.
**Why it might fail**: it replaces one long reply with several medium ones.

---

## 50% Rule Check

Option A at half the code: ship `viewport` only. Rejected narrowly: `within` is the same filter with a different predicate (about 15 more lines), and it is the scope an agent needs when a dialog is open.

---

## Recommended Path

**Option A — Opt-in filters**

**Next Actions**
1. T043 after T042 merges (same function).
2. If real use shows agents never pass the arguments, revisit Option B with data.

**Cut list**: automatic scoping; scoping to the topmost modal by default; paging; scoping `overlays`, `focused` or `messages` (they stay page-wide).

---

## Surgical Scope

Files that **should** be touched:
- `src/tools/web.ts` — scope options in `getPageState`, filter in the read pass, the note; `within` added to `REF_ARGUMENTS`
- `src/server.ts` — two arguments on `ui_get_page_state`, a few words in its description and in the cap note
- `test/web.test.ts`, `test/multi-session.test.ts` — scope tests
- `README.md`, `RUNBOOK.md`, `site/index.html`, `PRD.md` — document the two arguments

Files that **must not** be touched:
- `buildSelector`, `resolveRef`, `renderCompact`, the action functions — unchanged behaviour
- `src/tools/session.ts`, `src/reports/index.ts`, `src/api/run-test.ts`, `src/stdio.ts`

---

## Edge Case Checklist for TASK_GUIDE

- [ ] No arguments: the reply is byte-identical to today's for the same page.
- [ ] `within` that matches no element, several elements, or a stale ref fails clearly and lists nothing.
- [ ] `within` an element with no interactive descendants returns an empty list with the scope note, not an error.
- [ ] `viewport: true` on a page scrolled halfway lists what is on screen now, not what was on screen at load.
- [ ] An element partly inside the viewport counts as inside.
- [ ] The 200 cap applies after scoping; both notes can appear together.
- [ ] Refs number the returned (scoped) list, and each resolves to its listed element.
- [ ] `format: "full"` honours the same scope arguments.
- [ ] The focused element outside the scope is still reported as `role "name"`.
- [ ] The tool list stays at or under 20,000 characters.
- [ ] The T042 retry still works with a scope (a `within` root that vanishes mid-pass is a failure after the budget, not an empty list).
