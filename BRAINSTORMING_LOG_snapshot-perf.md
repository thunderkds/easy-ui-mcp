# BRAINSTORMING_LOG — Snapshot speed on very large pages
**Generated**: 2026-11-11
**Task / Context**: T045. Risk: Medium — changes when a ref's selector is built (T040 internals) and how a snapshot pass holds elements (T042 internals).
**Skill**: `Skill({ skill: "brainstorming" })` · **Tier**: Standard
**Evidence**: Supervisor profile, 2026-11-11, `en.wikipedia.org/wiki/Microsoft` (4,330 interactive candidates, 3,959 listed before the cap), main @ bf2647d

---

## The Problem Space

A compact `ui_get_page_state` on that page took 19–31 s; with `viewport: true`, 11–19 s. Where one 31 s call went:

| Time | Calls | What |
|---|---|---|
| 12.5 s | 144 | `role=…[name=…]` selector checked against the page, one round trip per listed element (about 90 ms each: Playwright's role engine scans the whole document every time) |
| 7.0 s | 57 | positional fallback `INTERACTIVE_SELECTOR >> nth=i` checked the same way (about 120 ms each) |
| 4.6 s | 28 | shared role match, sent with all 4,330 handles as the argument |
| 3.2 s | 35 | `role=… >> nth=n` checks |
| 1.9 s | 1 | `page.$$`: one element handle per candidate, 4,330 of them |
| 0.7 s | — | disposing those handles |
| 0.5 s | 1 | the in-page read pass (rects, names, state) |
| 0.3 s | 43 | `#id` checks |

So about 27 s is selector verification for the 200 listed elements, and about 2.6 s is taking and releasing 4,330 handles. The read pass itself is half a second.

The compact reply prints no selector. A selector is used only when the agent later passes a ref to a tool, or when it asks for `format: "full"`.

Non-negotiable:
- A ref never reaches an element other than the one that was listed (T040).
- `format: "full"` returns the same struct as today.
- A snapshot taken while the page re-renders is retaken, never quietly empty (T042).
- Reports show the resolved selector, never a bare ref.
- Nothing is injected into the page.

Verified against the code:
- `getPageState` is called from one place in `src/server.ts` with `keepRefs: format !== "full"`.
- `resolveRef` re-checks `entry.selector` against `entry.handle` by identity on every use (`locate`), so a selector built at that moment is verified the same way.
- `renderCompact` finds the focused element's ref by comparing selectors; without selectors it needs another way.
- The T042 "moved" signal has two sources: a visible element whose selector could not be verified, and the `isConnected` check over every handle at the end of the pass.

---

## Questions for the User

Decided by the Supervisor under "let do T045" (2026-11-11); say so if you disagree:
1. In the compact reply a ref follows the listed node: it resolves while that exact node is still in the document. Today a ref to one of several identical siblings goes stale when they are re-ordered; after this change it still reaches the same node. ⚠ decided for you
2. `format: "full"` keeps verifying every selector up front, so it stays slow on a page this large. ⚠ decided for you

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | Selectors on demand | Compact snapshots build no element selectors; a ref's selector is built and verified when the ref is used. One array handle replaces 4,330 element handles | Medium | ~120 lines + tests | Medium | ✅ Yes |
| B | Verify in the page | Re-implement role and name matching inside one `evaluate` and verify all 200 selectors in one round trip | High | ~250 lines + tests | High | |
| C | Smaller candidate set | Read only the viewport, or stop at the first 200 candidates | Low | ~30 lines | High | |

### Option A — Selectors on demand
**Approach**: `getPageState` gets an option the server sets for the compact format. With it, the pass lists elements without selectors and stores, per ref, the handle and the facts `buildSelector` needs. `resolveRef` builds the selector on first use (1–3 round trips for one element) and verifies it by identity, as today. The pass holds the candidates as one array handle and takes element handles only for the listed rows.
**Pros**: removes about 300 round trips from every compact snapshot, on every page, not only huge ones; no new matching logic; full format untouched.
**Cons**: a ref costs up to about 300 ms on first use on a huge page; staleness is by node identity only (question 1); two ref-entry shapes.
**Why it might fail**: the T042 retry loses one of its two signals in compact mode. Mitigation: the `isConnected` check stays, and the T042 tests are run in the compact mode too.

### Option B — Verify in the page
**Approach**: compute Playwright-compatible role and accessible name in the page, in one call.
**Pros**: full format becomes fast too.
**Cons**: duplicates a selector engine; any disagreement with Playwright produces a selector that later misses or hits another element.
**Why it might fail**: it trades a slow correct check for a fast approximate one, against the T040 rule.

### Option C — Smaller candidate set
**Approach**: collect fewer candidates.
**Pros**: tiny.
**Cons**: the positional fallback indexes the page-wide list; the totals in the notes become wrong; verification, the real cost, stays.
**Why it might fail**: it does not touch the 27 s.

---

## 50% Rule Check

Option A at half the code: only skip the selectors, keep `page.$$`. That leaves about 3 s per snapshot on this page (handles in, handles out, the `isConnected` argument). Kept as the fallback if the array-handle step proves risky; the task guide lists it as the second slice.

---

## Recommended Path

**Option A — Selectors on demand**

**Next Actions**
1. T045 guide with a fixed local fixture and a round-trip count, so the test does not depend on wall-clock time.
2. Supervisor measures the Wikipedia page and reruns the four baseline flows.

**Cut list**: a faster `format: "full"`; re-reading role and name when a ref is used; lazy overlay selectors (overlays are few).

---

## Surgical Scope

Files that **should** be touched:
- `src/tools/web.ts` — `getPageState` option, `snapshotPass`, `buildSelector` target argument, ref entries, `resolveRef`, the focused line in `renderCompact`
- `src/server.ts` — the one `getPageState` call
- `test/web.test.ts`, `test/multi-session.test.ts` — tests
- `RUNBOOK.md` (and README / PRD only where a sentence becomes wrong)

Files that **must not** be touched:
- the action functions, `resolveRefArgs`, `scopeNote`
- `src/tools/session.ts`, `src/reports/index.ts`, `src/api/run-test.ts`, `src/stdio.ts`

---

## Edge Case Checklist for TASK_GUIDE

- [ ] `format: "full"` struct is deep-equal to today's on the existing fixtures.
- [ ] A ref to a replaced node, a removed node, or after a navigation is stale.
- [ ] A ref to one of several identical siblings reaches that node after a re-order.
- [ ] A ref whose selector cannot be verified at use fails as stale; nothing is done.
- [ ] The focused element prints as its `@eN` when it is listed, as `role "name"` when it is not.
- [ ] `within: "@eN"` and every other ref argument still work.
- [ ] The T042 re-render and never-settles cases behave the same in compact mode.
- [ ] Handles: at most the listed elements' handles outlive the pass; everything else is disposed, also on a throw.
- [ ] The number of selector round trips in a compact snapshot does not grow with the number of listed elements.
