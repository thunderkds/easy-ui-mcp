# TASK_REVIEW — T017: Fix `ui_get_page_state` naming and surface on-page messages

> Sibling of `tasks/TASK_GUIDE_T017.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | pass | `test/web.test.ts` — 9 new getPageState tests (T017 AC1-AC7 + edge cases); red before the fix (9 fail), green after |
| Verification command run | pass | Implementer: 25/25 at ~06:35Z (pre-fix-round), 27/27 after 1565f89. **Supervisor re-run 2026-10-30 07:19Z at 1565f89**: `node --import tsx --test test/web.test.ts test/session.test.ts test/reports.test.ts` → `ℹ tests 73 / ℹ pass 73 / ℹ fail 0`; `npx tsc --noEmit` → clean |
| Negative cases hold | pass | empty / `display:none` / zero-size alerts -> `messages: []`; `aria-live=off` ignored; password `value` never used as name; unnamed + invisible elements excluded; `getPageState(undefined)` still `No active page` error |
| verify | pass | Supervisor re-ran the Demonstration script against 1565f89 at 07:19:48Z in real headless Chromium: `elements` now include `{textbox, Email}`, `{textbox, Search}`, and `messages:["Password too short"]` — pass. `ui_get_page_state` in `src/server.ts:390` returns `JSON.stringify(result)` unchanged, so the MCP tool output carries the new fields. A live MCP drive against the Docker container is **deferred to integration**: the server port is hard-coded to 8765 and the running container is the user's — rebuilding it needs the user's go-ahead. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | pass | Reviewed `getPageState` in `src/tools/web.ts`, its tests, and its two callers (`src/server.ts:390` tool handler, `src/reports/index.ts:135` describe case — no change needed). Nothing else touched. |
| Full smoke suite still green (no regression) | pass (unit) | web 27/27, session + reports green (73 total). `test/api-run-test.test.ts` / `test/health.test.ts` not run — they spawn a server on port 8765, already owned by the user's running container (known pre-existing collision, MEMORY.md). |
| **UI: Visual regression (diff or verdict pasted)** | N/A | backend-only task, no UI surface |
| **UI: Design-system compliance (tokens/colors/typography verified)** | N/A | backend-only task, no UI surface |
| **UI: Responsiveness at target viewports** | N/A | backend-only task, no UI surface |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured before any implementation commit; unmodified code at HEAD 52ce70d):

```
$ date -u
Fri Oct 30 06:33:32 AM UTC 2026
$ node --import tsx scratchpad/demo.mts   # setContent(Requirement fixture); console.log(JSON.stringify(await getPageState(page)))
{"ok":true,"url":"about:blank","title":"","elements":[{"role":"combobox","name":"A"},{"role":"button","name":"Save"}]}
```

Both text inputs (Email, Search) are missing and there is no `messages` field, so "Password too short" is not reported.

**AFTER** (same script, same fixture, after commit d7bb169):

```
$ date -u
Fri Oct 30 06:35:27 AM UTC 2026
$ node --import tsx scratchpad/demo.mts
{"ok":true,"url":"about:blank","title":"","elements":[{"role":"textbox","name":"Email"},{"role":"textbox","name":"Search"},{"role":"combobox","name":"A"},{"role":"button","name":"Save"}],"messages":["Password too short"]}
```

**DELTA**: An agent calling `ui_get_page_state` now sees label-/placeholder-named inputs (`Email`, `Search`) and the visible validation text (`messages: ["Password too short"]`), so it can plan which fields to fill and react to errors.

**WITNESS**: Supervisor, 2026-10-30 07:19:48Z — re-ran the same fixture script at 1565f89 (post fix-round) and got the identical AFTER output.

---

## Notes

- **Name precedence (Stage 4 pre-review change)**: final order is aria-label > aria-labelledby > label > text content (innerText) > placeholder > title > value (button-type inputs only). The guide's original AC4 had `title` above text content; the Supervisor corrected it so a button with visible text is not renamed by its tooltip.
- **Role mapping (Stage 4 pre-review change)**: an explicit `role` attribute wins; otherwise `input[type=checkbox]` -> `checkbox`, `radio` -> `radio`, `submit|button|reset|image` -> `button`, `range` -> `slider`, any other input and `textarea` -> `textbox`, `select` -> `combobox`. Needed so T018 `role=<role>[name=...]` selectors and T019 `ui_set_checked` see correct roles.


---

## Code Review (Stage 4, light tier — Supervisor, 2026-10-30)

Scope: `52ce70d..1565f89`, `src/tools/web.ts` `getPageState` + `test/web.test.ts`; callers `src/server.ts:390`, `src/reports/index.ts:135`. Personas: correctness, testing, maintainability, standards. Security/performance/adversarial not activated (Low risk, <50 source lines, no input sink beyond page DOM).

Entry-point reachability: `ui_get_page_state` found at `src/server.ts:383` — reachable.

Pre-review round (fixed in 1565f89): P2 name precedence (`title` outranked visible text); P2 input roles (checkbox/radio/submit all reported as `textbox`, which would break T018 role selectors and T019 `ui_set_checked`).

### P0 — Must Fix
None.

### P1 — Should Fix
None.

### P2 — Recommended
None remaining.

### P3 — Optional (follow-ups, not blocking)
| File | Finding | Confidence | Action |
|---|---|---|---|
| `src/tools/web.ts` | Unlabeled `<select>` is named by all its options' text (truncated at 80) | 100 | Name it by the selected option's text when no label exists |
| `src/tools/web.ts` | `<input type=image alt=…>` with no other name is dropped (`alt` not in the chain) | 75 | Add `alt` after `title` |
| `src/tools/web.ts` | A `[aria-live]` container that wraps a `role=alert` child reports both texts (parent includes child) | 75 | Skip message nodes that have a message-node ancestor |
