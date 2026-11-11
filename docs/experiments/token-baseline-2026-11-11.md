# Token baseline: current page state vs compact snapshot with refs

**Date**: 2026-11-11 · **Code under test**: main @ 2669cfa (no source changes) · **Status**: experiment only, nothing shipped

## Result

Compact snapshots with refs cut the tool traffic of a flow by **1.7× on app-style pages and about 5× on link-heavy pages**. Counting the fixed tool-schema cost, a whole flow shrinks by **1.1× to 2.8×**. The plan's 5–10× target is not reachable with this change alone.

## What was run

Four scripted flows were driven through the real MCP server over stdio (`src/stdio.ts`), and every request and reply was recorded. The "compact + refs" column is computed from the same recording: each `ui_get_page_state` reply is re-rendered as one line per element (`@e3 button "Login" disabled`), and each selector argument that came from a snapshot is replaced by its ref.

- The scripted agent takes a snapshot after each page change, picks elements by role and name, and brackets the flow with `ui_start_session`, `ui_step` and `ui_end_session`.
- Tokens are estimated as characters ÷ 4. JSON with escaped quotes usually tokenizes worse than plain text, so the saving is more likely understated than overstated.
- A second in-process pass replayed each flow to learn which listed elements were inside the 1280×720 viewport.

## Per flow

Tool traffic is requests plus replies. The tool list costs a fixed ~6,700 tokens per conversation in both columns.

| Flow | Calls | Snapshots | Traffic now | Traffic compact + refs | Ratio | With schema: now → compact | Ratio |
|---|---|---|---|---|---|---|---|
| TodoMVC (small app) | 18 | 3 | 1,413 | 824 | 1.7× | 8,118 → 7,529 | 1.08× |
| Saucedemo (login + checkout) | 25 | 6 | 2,092 | 1,205 | 1.7× | 8,797 → 7,910 | 1.11× |
| Wikipedia (long article) | 14 | 3 | 26,192 | 4,897 | 5.3× | 32,897 → 11,602 | 2.8× |
| Hacker News (link list) | 14 | 4 | 27,086 | 5,494 | 4.9× | 33,791 → 12,199 | 2.8× |

If nothing is cached, the model re-reads the whole transcript every turn. That cumulative figure moves by the same ratios: 11.0k → 6.7k (TodoMVC), 26.2k → 14.9k (Saucedemo), 200.7k → 36.3k (Wikipedia), 154.6k → 39.7k (Hacker News).

## Snapshot sizes

| | Now | Compact + refs |
|---|---|---|
| App pages (9 snapshots, 3–24 elements) | 69–582 | 28–254 |
| Content pages (7 snapshots, 172–200 elements) | 4,034–13,388 | 1,049–1,566 |
| Median of all 16 | 452 | 183 |

The plan's "median under 400" holds on this mix, but the distribution has two clusters. Content pages stay above 1,000 tokens in compact form.

## Other levers

| Lever | Measured effect | Reading |
|---|---|---|
| Viewport-only snapshot, on top of compact | Wikipedia snapshots 4,474 → 2,521; Hacker News 5,113 → 2,891; Saucedemo 580 → 504; TodoMVC unchanged | Roughly halves content pages. 1 of 21 picked targets was off-screen and would need an extra scroll and snapshot. |
| Replies cut to `{"ok":true}` | Saves 169–257 tokens per flow (12–17 per call) | Small next to snapshots on content pages (under 1%), but 10–18% of traffic on the two app flows. Refs already shorten the echo. |
| Tool list (26 tools) | 6,705 tokens fixed | 76–83% of the total on the two app flows. For app-style testing this is the largest single cost. |

## Findings that affect the design

1. **Selectors are the main waste.** The largest single snapshot was 13,388 tokens for 200 elements (Hacker News comments); compact form is 1,049.
2. **The 200-element cap was hit on 5 of 16 snapshots.** Elements past the cap are invisible to the agent in both formats.
3. **Many lines are identical.** Up to 138 of 200 elements on one page share role and name ("hide", "reply"). Position in the list is the only cue, as it is today with `nth=`. Refs must be bound to the exact element, not to role and name.
4. **Unnamed elements are not listed.** The Saucedemo cart icon has no accessible name, so the flow needed a CSS selector. Refs cannot replace selectors; the hybrid in the plan is required.
5. **A snapshot taken straight after a navigating click can be empty.** The first run got 0 elements on the Saucedemo cart page; an 800 ms client-side wait fixed it. This is existing behaviour and independent of the format.

## Limits

- The agent is a script, not a model, so agent success rate with refs is not measured.
- Four public sites, one run each; live content changes the numbers slightly between runs.
- Token counts are estimates, not tokenizer output.

## Recommendation

1. Ship compact snapshot with refs as the default, with `format: "full"` in the same task. Bind each ref to the exact element and invalidate refs on every new snapshot.
2. Trim tool descriptions next. On app-style flows it is worth more than the snapshot change.
3. Treat viewport-only or a `within` scope as a follow-up for content-heavy pages.
4. Keep the short action echo; do not reduce it to `{"ok":true}`.
5. Open a separate bug for the empty snapshot after a navigating click.

## Reproduce

```
node_modules/.bin/tsx docs/experiments/token-baseline.mts
```

It writes `results.json` and a `run/` folder (session reports) next to the script. Raw numbers for this run: `docs/experiments/token-baseline-2026-11-11.results.json`.
