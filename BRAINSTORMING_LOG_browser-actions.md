# BRAINSTORMING_LOG — Full browser-action audit
**Generated**: 2026-11-10 (rev 2 — full audit, per user: "check all the needed actions, not only the ones I listed")
**Task / Context**: Stage 0 — which actions does an agent need to test and debug a real web app, and which can't easy-ui-mcp do today?
**Skill**: `Skill({ skill: "brainstorming" })` — Tier: **Standard**

---

## The Problem Space

The agent drives a headless Chromium through 16 MCP tools (verified in `src/server.ts`):
`ui_start_session`, `ui_end_session`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_step`, `ui_get_page_state`, `ui_take_screenshot`.

The user can screenshot and debug flows. But many real-world interactions are missing. Some are missing actions, some are missing **observations**: the agent can't see that an overlay is open, can't read page text, can't see console errors mid-flow.

Non-negotiable constraints (memory/decisions):
- Primitive tools only; no server-side LLM.
- Every action goes through `runInteraction` → `recordAction`, so the report and the hard/soft verdict stay truthful.
- Each tool name is spelled once in `TOOL` and has a `describe()` sentence in `src/reports/index.ts`.
- Selectors must match exactly one element (`resolveUniqueLocator`).

Benchmark: Microsoft's Playwright MCP covers roughly the same ground with click options (double, right, modifiers), typing, drag, file upload, dialog handling, resize, tabs, back, evaluate, console/network reads and coordinate clicks. Gaps below are measured against that tool list plus common app patterns.

---

## Full audit

Status: ✅ exists · 🟡 partial · ❌ missing. Priority: P0 = blocks common flows today, P1 = frequent, P2 = specialised.

### A. Pointer / mouse
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| A1 | Click outside / on backdrop | Close modal, drawer, popover, menu | ❌ `ui_click` clicks the element centre (`web.ts:62`), which the panel covers → 5s timeout; `<dialog>::backdrop` can't be selected | `ui_click_outside(selector)` — click a free point outside the box; report what was hit | P0 |
| A2 | Click at offset / force click | Backdrop corner, element under a transparent layer | ❌ | `ui_click` + `position {x,y}`, `force` (report says "forced") | P0 |
| A3 | Double-click | Edit a table cell, select a word, open a file | ❌ | `ui_click` + `clickCount: 2` | P1 |
| A4 | Right-click | Context menus | ❌ | `ui_click` + `button: "right"` | P1 |
| A5 | Modifier click (Ctrl/Shift/Meta) | Multi-select rows, range select, open in new tab | ❌ | `ui_click` + `modifiers: ["Shift"]` | P1 |
| A6 | Hover | Dropdown menus, tooltips | ✅ `ui_hover` | — | — |
| A7 | Drag and drop | Kanban, sortable lists, reorder, upload drop zones | ❌ | `ui_drag(from, to)` | P1 |
| A8 | Slider / range input | Price filters, volume | ❌ (Playwright `fill` refuses `type=range`) | Covered by A7, or ArrowRight via `ui_press_key` | P2 |
| A9 | Scroll inside a container, horizontal, to top | Chat panes, virtual tables, carousels, infinite lists inside a panel | 🟡 `ui_scroll` only scrolls the page down or an element into view | `ui_scroll` + `container`, `direction` (up/down/left/right/top/bottom) | P1 |
| A10 | Long-press / press-and-hold | Hold-to-confirm buttons, mobile menus | ❌ | `ui_click` + `delay` ms | P2 |
| A11 | Touch tap / swipe | Mobile carousels, swipe-to-dismiss | ❌ (no touch context) | `hasTouch` via device emulation (G2) + `tap` | P2 |

### B. Keyboard & text
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| B1 | Press key / combo | Escape, Enter, Tab, arrows, Ctrl+A | ✅ `ui_press_key` (T019). **If the agent doesn't see it, the 8765 container is older than T019 → rebuild** | — | — |
| B2 | Type key by key | Autocomplete, search-as-you-type, masked inputs (phone, card), OTP boxes, editors that ignore `fill` | ❌ `ui_fill` sets the whole value at once | `ui_type(selector, text, delayMs?)` (`pressSequentially`) | P1 |
| B3 | Clear a field | Reset an input | ✅ `ui_fill` with `""` | — | — |
| B4 | Focus / blur | Validation shown on blur | 🟡 Tab works; no direct blur | Covered by B1 (Tab) — no new tool | — |
| B5 | Know what has focus | Keyboard navigation, focus traps in modals (a11y) | ❌ page state doesn't say | `focused` field in `ui_get_page_state` | P1 |
| B6 | Rich text / contenteditable | Comment boxes, editors (Quill, TipTap, Notion-like) | 🟡 `fill` works, but `[contenteditable]` isn't in `INTERACTIVE_SELECTOR` (`web.ts:325`) → agent never gets a selector | Add to page state | P1 |
| B7 | Clipboard copy/paste | "Copy link" buttons, paste into fields | ❌ | Grant clipboard permission + read via assert | P2 |

### C. Forms & custom widgets
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| C1 | Native `<select>` | Dropdowns | ✅ `ui_select_option` | — | — |
| C2 | Custom combobox / listbox / switch / tabs panel | MUI/Ant/Radix selects, toggles, autocomplete options | 🟡 Can click them, but `role=combobox/listbox/option/switch/menuitemcheckbox/treeitem/slider`, `summary`, `[tabindex]` aren't in `INTERACTIVE_SELECTOR` → invisible in page state | Extend the selector list | P0 |
| C3 | Element state | Is the button disabled? Is the box checked? What's the input value? Is the accordion expanded? | ❌ page state returns only `{role, name, selector}` (`web.ts:304`) | Add `disabled`, `checked`, `value`, `expanded` to each element | P0 |
| C4 | Checkbox / radio | Forms | ✅ `ui_set_checked` | — | — |
| C5 | File upload | Avatar, attachments, CSV import | ❌ (deferred in T019) | `ui_upload_file(selector, path)` + file chooser handling; paths limited to a mounted folder | P1 |
| C6 | Date / colour pickers | Booking, filters | 🟡 `fill` on native input; custom pickers via clicks | — | — |

### D. Overlays & dialogs
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| D1 | Escape to close | Modals, menus | ✅ `ui_press_key Escape` | — | — |
| D2 | Know an overlay is open / closed | Every modal flow | ❌ page state ignores `role=dialog/alertdialog`, `dialog[open]`, `aria-modal` | `overlays: [{role, name, selector, modal}]` in page state | P0 |
| D3 | Native `alert` / `confirm` / `prompt` | "Delete? OK", "Leave page?" | ❌ **silent**: no `page.on("dialog")`; Playwright cancels them → `confirm()` always false, message lost | Session listener logs every dialog; `ui_dialog(accept|dismiss, text?)` sets the next answer | P0 |
| D4 | `beforeunload` | Unsaved-changes guard | ❌ same as D3 | Covered by D3 | P0 |
| D5 | Transient toasts | "Saved!" snackbar that disappears in 3s | 🟡 page state reads `role=status/alert` only at the moment it's called → toast often gone | Record messages as they appear (MutationObserver) into the session log + page state `recentMessages` | P1 |

### E. Navigation, tabs, frames, downloads
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| E1 | Back / forward / reload | History, persistence after refresh | ❌ (re-`ui_navigate` loses form state and history) | `ui_navigate_history(back|forward|reload)` | P1 |
| E2 | New tab / popup | `target=_blank` links, OAuth/payment popups | ❌ the session stays on the first page; the popup is invisible | Track `context.on("page")`; `ui_tabs(list|switch|close)` | P1 |
| E3 | iframes | Stripe/payment fields, embedded editors, widgets | ❌ page state doesn't look inside frames | Page state lists frame elements with selectors like `iframe#pay >> internal:control=enter-frame >> …` (Playwright accepts them in `page.locator`) | P2 |
| E4 | Downloads | "Export CSV / PDF" | ❌ | Capture `page.on("download")`, save to reports, return file name + size | P2 |
| E5 | Wait for URL / network idle | After submit | ✅ `ui_wait_for` with a JS expression (`location.pathname === …`) | — | — |

### F. Observing & debugging
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| F1 | Read text on the page | Check a table value, a heading, an error under a field, a total | ❌ **big gap**: page state = interactive elements + live-region messages; `ui_assert`/`ui_check` return only true/false | `ui_get_text(selector?)` — trimmed `innerText`, length-capped; or a `text` outline (headings + landmarks) in page state | P0 |
| F2 | Screenshot the agent can see | Visual debugging | 🟡 returns a path; works only because `./reports` is mounted and Claude can Read the PNG | Also return the PNG as MCP image content (opt-in flag) | P1 |
| F3 | Element / full-page screenshot | Long pages, one component | ❌ viewport only | `ui_take_screenshot` + `selector?`, `fullPage?` | P1 |
| F4 | Console errors / page errors mid-flow | "Why did the button do nothing?" | 🟡 captured into the report only (`session.ts:147`) — agent can't read them until the end | `ui_get_logs(since?)` | P1 |
| F5 | HTTP 4xx/5xx responses | API returned 500 but UI shows nothing | ❌ only network-level `requestfailed` is captured; a 500 is a *successful* request to Playwright | Capture `response.status() >= 400` into issues | P1 |
| F6 | Accessibility tree | a11y checks, better element names | ❌ | Later; `ariaSnapshot()` | P2 |

### G. Environment / context
| # | Action | Real-world use | Status | Proposal | Pri |
|---|---|---|---|---|---|
| G1 | Viewport size | Phone (375px) and tablet layouts | ❌ fixed 1280×720 (`session.ts:104`) | `ui_set_viewport(width, height)` + `viewport` on `ui_start_session` | P0 |
| G2 | Device emulation | Mobile user agent, touch, pixel ratio | ❌ | `device: "iPhone 13"` on `ui_start_session` (Playwright `devices`) | P2 |
| G3 | Dark mode / locale / timezone | Theme bugs, i18n, date formats | ❌ | `colorScheme`, `locale`, `timezoneId` on `ui_start_session` | P2 |
| G4 | Reuse login (cookies / storage) | Skip login in every session | ❌ | `ui_save_auth(name)` / `auth: name` on start (Playwright `storageState`) | P2 |
| G5 | Mock / block network, offline | Test error and empty states | ❌ | `ui_mock_route(urlPattern, status, body)`, `ui_set_offline` | P2 |
| G6 | Permissions / geolocation | Maps, notifications | ❌ | Options on `ui_start_session` | P3 |
| G7 | Fake clock | Countdown, session-timeout banners | ❌ | `page.clock` | P3 |

### H. Escape hatch
| # | Action | Status | Note |
|---|---|---|---|
| H1 | `ui_evaluate(js)` returning a value | ❌ (`ui_assert` evaluates JS but returns only pass/fail) | Would cover F1 and much of G quickly. But synthetic events are untrusted, so it must be documented as **read-only/debug**, never for interactions |

**Count:** 9 exist, 6 partial, 32 missing. **P0 = 9 items:** A1, A2, C2, C3, D2, D3/D4, F1, G1.

---

## Questions for the User

1. Is the P0 list right (overlay closing, native dialogs, custom widgets + element state in page state, reading page text, viewport)? Or is something in P1 hurting you more?
2. Should a `confirm()` the agent didn't answer default to **accept** or **dismiss**? (Today it is cancelled with no record.)
3. Should a value-returning `ui_evaluate` be allowed (fast coverage, but can be misused for fake clicks)?

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|---|---|---|---|---|---|---|
| A | Many intent tools | One new tool per action (~20 new tools) | Medium | ~900 lines | Low | |
| B | Extend existing tools + few new ones | Options on `ui_click`/`ui_scroll`/`ui_take_screenshot`/`ui_start_session`/page state; new tools only for new concepts (dialog, drag, type, upload, tabs, history, text, logs, viewport) | Medium | ~600 lines | Low–Med | ✅ Yes |
| C | Escape hatch first | `ui_evaluate` + coordinate `ui_mouse`, little else | Low | ~120 lines | High (false passes) | |

### Option A — Many intent tools
**Pros**: Each tool has one clear purpose; easy to describe in reports.
**Cons**: The tool list grows from 16 to ~36. Every tool description costs context on every agent turn, and a long list makes tool choice worse.
**Why it might fail**: The agent picks the wrong tool, or never discovers the right one.

### Option B — Extend existing tools + a few new ones (recommended)
**Approach**: Options instead of tools where the verb is the same:
- `ui_click {button, clickCount, modifiers, position, force, delay}` covers A2–A5 and A10.
- `ui_scroll {container, direction}` covers A9.
- `ui_take_screenshot {selector, fullPage, inline}` covers F2 and F3.
- `ui_start_session {viewport, device, colorScheme, locale}` covers G1–G3.
- Page state gains `overlays`, `focused`, element `state`, and wider roles. That covers B5, B6, C2, C3 and D2.

New tools only for new verbs: `ui_click_outside`, `ui_dialog`, `ui_type`, `ui_drag`, `ui_upload_file`, `ui_navigate_history`, `ui_tabs`, `ui_get_text`, `ui_get_logs`, `ui_set_viewport`. That is ~10 new tools (16 → ~26).
**Pros**: Covers almost every row while keeping the tool list readable, and fits `runInteraction`.
**Cons**: `ui_click` options interact (`force` + `position`), and each combination needs a test.
**Why it might fail**:
- Page-state growth means bigger JSON per call. Mitigation: element state only when non-default, overlays only when present.
- More options mean more ways to get a false pass from `force`. Mitigation: the report marks forced clicks.

### Option C — Escape hatch first
**Pros**: Smallest; unblocks anything.
**Cons**: `dispatchEvent` clicks/keys are `isTrusted:false`, and many apps and native behaviours ignore them. Coordinate clicks need positions the agent doesn't have. Reports become JS blobs.
**Why it might fail**: Tests pass on paths a real user never hits. That contradicts the project goal of truthful verdicts (T013).

---

## 50% Rule Check

Half the code for the same goal: ship only the **observation** fixes (page state: overlays, element state, wider roles, focused; `ui_get_text`) plus `ui_click` options, `ui_click_outside`, native dialogs and viewport.
That is roughly 6 changes, and they cover every P0 row. Everything else waits until a real flow needs it.

---

## Recommended Path

**Option B, delivered as 4 tasks in priority order:**

| Task | Scope | Rows |
|---|---|---|
| T030 | **See the page**: page state gains `overlays`, element `state` (disabled/checked/value/expanded), `focused`, wider roles incl. contenteditable; new `ui_get_text` | C2, C3, D2, B5, B6, F1 |
| T031 | **Close and answer**: `ui_click_outside`; `ui_click {position, force, button, clickCount, modifiers}`; native dialog listener + `ui_dialog` | A1–A5, D3, D4 |
| T032 | **Real users, real sizes**: `ui_set_viewport` + session `viewport/device/colorScheme/locale`; `ui_type`; `ui_navigate_history`; `ui_scroll {container, direction}`; screenshot `selector/fullPage/inline` | G1–G3, B2, E1, A9, F2, F3 |
| T033 | **Debug + multi-page**: `ui_get_logs`, HTTP ≥400 capture, `ui_tabs`, `ui_upload_file`, `ui_drag`, downloads | F4, F5, E2, C5, A7, E4 |
| later | iframes, auth reuse, network mocking, clock, a11y tree, `ui_evaluate` | E3, G4–G7, F6, H1 |

Before T029: **rebuild the 8765 container** so `ui_press_key` (T019) is live; otherwise Escape looks missing.

## Edge Case Checklist (for TASK_GUIDEs)
- `<dialog>::backdrop` is not an element: click-outside must use coordinates.
- A click-outside point can land on another control. Choose a point where `elementFromPoint` is non-interactive, and report the element that was hit.
- An overlay covering the whole viewport: fail clearly and suggest Escape.
- Overlay close animations: page state must treat `hidden` / `aria-hidden` / `display:none` / `visibility:hidden` as closed.
- Nested overlays: report the topmost first.
- A native dialog nobody answered: apply the default, log it, never hang the page.
- `force: true` and `position` skip checks, so the report must say "forced".
- `ui_get_text` must cap its length; the page-state 200-element cap stays.
- `ui_upload_file` paths: allow only a mounted folder (no reading arbitrary container files).
- HTTP ≥400 capture: ignore expected 401 on a probe? Keep it as a report issue, not a failure (same as console errors, FR-018).
- Tabs: the session page must follow the switched tab, and `ui_end_session` must close every tab.
- Viewport change mid-session: `nth=` selectors may go stale; tell the agent to re-read page state.

## Surgical Scope
**Touch**:
- `src/tools/web.ts`
- `src/server.ts`: `TOOL` entries via `runInteraction`
- `src/tools/session.ts`: dialog, popup, response and download listeners; context options
- `src/reports/index.ts`: `describe()` lines
- `test/web.test.ts`, `test/session.test.ts`, `test/reports.test.ts`, `test/docs-tools.test.ts`
- README / RUNBOOK / HARNESS tool lists and counts, and the `site/` tool list

**Must not touch**:
- `isFatalOutcome` semantics
- The `resolveUniqueLocator` exactly-one-match contract
- The REST `/api/run-test` shape
- The MCP transport

## Next Actions
1. User answers Q1–Q3.
2. Stage 2: write TASK_GUIDEs T030–T033 (T029 was already taken by the multi-session task) and add them to `PROJECT_KANBAN.md` Todo.
