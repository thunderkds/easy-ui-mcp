# BRAINSTORMING_LOG_agent-ergonomics.md

**Date**: 2026-10-30
**Scope**: T017, T018, T019, T021: making the `ui_*` tools easier for an agent to drive and making results easier for a human to find and read.
**Status**: Recommended paths chosen **provisionally by the Supervisor** under the user's 2026-10-30 instruction ("auto work on the pending task as parallel, if any task need my confirm, defer to my next"). The user has not yet approved them. They are listed under *Pending user confirmation* at the end.

---

## The Problem Space

The user's stated targets (2026-10-30): **executable, simple as is, easy for the agent to drive, readable test results.**

Evidence gathered on 2026-10-30, all from running code or the file system rather than inference:

1. **`ui_get_page_state` hides text inputs.** A fixture containing `<label for=e>Email</label><input id=e placeholder=…>`, `<input placeholder="Search">`, a `<select>`, a `<button>Save</button>` and a `<div role=alert>Password too short</div>` returned only:
   `{"elements":[{"role":"combobox","name":"A"},{"role":"button","name":"Save"}]}`.
   Root cause: `web.ts:244` evaluates `innerText?.trim() ?? placeholder`. For an `<input>`, `innerText` is `""`, which is not nullish, so the placeholder is never reached and the element is filtered out as unnamed. `<label for>` and `aria-labelledby` are never consulted. Alert and status text is not collected at all, because only interactive elements are queried.
2. **No actionable handle.** Each page-state element is `{role, name}`. Nothing in it can be passed to `ui_click`/`ui_fill`, so the agent invents CSS selectors. Uniqueness failures (`matched N elements`) and misses (`No element matched`) both come from that guess.
3. **Missing primitives.** There are no tools for selecting a `<select>` option, pressing a key, hovering, checking or unchecking a box, or scrolling. Forms that submit on Enter, dropdowns, hover menus and lazy lists cannot be driven at all.
4. **Reports are hard to find.** `reports/` holds 470 `session-<uuid>.{json,html}` files and 803 loose screenshots, with no index. A human cannot tell which file belongs to which run without opening it.

**Non-negotiable constraints** (from `PROJECT_SPEC.md` and prior decisions):
- No server-side LLM.
- Reports stay self-contained single files.
- `ui_assert` semantics stay unchanged (T013 additive-only ruling).
- `run-test.ts` and existing tests must not break.
- Keep it simple: no new abstraction layers.

---

## T017: page-state naming

| Option | Approach | Why it might fail |
|---|---|---|
| A. Patch the `??` chain | Use `\|\|` instead of `??` and add `<label for>` | Still misses `aria-labelledby`, wrapping `<label>`, and `title`. Brittle hand-rolled spec. |
| **B. Ordered accessible-name lookup (recommended)** | One small in-page function with this order: `aria-label` → `aria-labelledby` text → `<label for=id>` / wrapping `<label>` → `placeholder` → `title` → `alt` → trimmed text → `value` (for button-like inputs only). Collect `role=alert` / `role=status` / `aria-live` text into a separate `messages: string[]` field. | It is still an approximation of the ARIA name algorithm, but it covers the cases agents actually hit. |
| C. Playwright `page.accessibility.snapshot()` / ARIA snapshot | Delegate naming to Chromium | The API shape differs across Playwright versions (`accessibility` is deprecated), the output is a large tree, and there is no element-to-DOM handle for T018. |

**Recommendation: B.** Small, deterministic, and testable against a fixture. It also keeps the per-element loop that T018 needs.

## T018: actionable locator

| Option | Approach | Why it might fail |
|---|---|---|
| **A. A Playwright selector string per element (recommended)** | Add a `selector` to each element, choosing the first strategy that yields exactly one match: `[data-testid="…"]` → `#id` (CSS-escaped) → `role=<role>[name="<name>"]` (Playwright's role selector engine) → append `>> nth=<i>` as a last resort. The `ui_click`/`ui_fill` input schema stays a string, and only their descriptions change. | `nth=` handles are positional and go stale if the DOM reorders. Mitigation: the agent re-reads state after navigation, and the description says so. |
| B. Opaque ref IDs (`e12`) stored in a server-side map | Accurate for a single snapshot | Adds server state, plus invalidation rules after every action. More complex. |
| C. Separate `role` + `name` parameters on click/fill | Explicit | Schema change on two tools, and the agent still needs a fallback for elements without a role. |

**Recommendation: A.** No schema change, no server state, and the value round-trips straight into the existing tools.

## T019: missing primitives

**Recommended set (provisional names)**: `ui_select_option(selector, value)`, `ui_press_key(key, selector?)`, `ui_hover(selector)`, `ui_set_checked(selector, checked)`, `ui_scroll(selector?)`.
- `ui_scroll` without a selector scrolls one viewport down. With a selector, it scrolls that element into view.
- All of them reuse `resolveUniqueLocator` and the existing `recordAction`. `describe()` in `reports/index.ts` gets one phrase per tool so reports stay readable.
- **Cut**: file upload, drag-and-drop, multi-tab, iframes.
- **Rejected alternative**: a single `ui_action(kind, …)` multiplexer. One tool per verb matches the existing vocabulary and gives better tool descriptions for the agent.

## T021: findable reports

| Option | Approach | Why it might fail |
|---|---|---|
| **A. Readable names + a regenerated index (recommended)** | Name new reports `session-<YYYYMMDD-HHMMSS>-<slug>-<id8>.{json,html}`, where the slug comes from the session `target` (lower-case, `[a-z0-9-]`, ≤40 chars) and `id8` is the first 8 characters of the UUID, so names stay unique. After each `writeReports`, rewrite `reports/index.html` as a self-contained, newest-first table of the session JSON files: time, label/target, status, action count and a link. The full UUID stays inside the JSON. | Scanning hundreds of JSON files on every write. Mitigation: read only the header fields, cap the index at the newest 500, and never let an index failure fail the session report. |
| B. A sidecar `sessions.jsonl` append log plus an index | O(1) per write | A second source of truth that drifts from the files on disk. |
| C. Index only, no rename | Smallest change | PR attachments stay as bare UUIDs. The user explicitly asked for readable results. |

**Recommendation: A.**
- **Cut / deferred to the user**: deleting the 803 existing loose screenshots and renaming the 470 existing reports. Both destroy or move the user's files, so they need the user's confirmation.
- Old `session-<uuid>` files must still appear in the index.

---

## Sequencing

- **Lane 1 (sequential, same functions in `web.ts`/`server.ts`)**: T017 → T018 → T019.
- **Lane 2 (parallel)**: T021 only touches `reports/index.ts` (naming and the index writer) and its tests. T019 later adds `describe()` phrases in the same file; that is a small textual conflict, resolved at integration.

## Pending user confirmation (deferred per instruction)

1. Approve the recommended paths above, or redirect them.
2. Approve the T019 tool names.
3. Delete or archive the 803 loose screenshots and rename the old reports (T021 cut list).
4. Merge the completed branches into `main` and push.
5. T014 readability judgement (pre-existing).
