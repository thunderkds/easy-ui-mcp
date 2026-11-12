# decisions.md — Cold Tier: Architectural & Infrastructure Decisions

> **Rules**: Supervisor-only writes. Each entry: `### YYYY-MM-DD — Title`, then **Decision**, **Why**, and **Files** (cite paths — the diff-driven pass greps this file by changed file path).

## Architecture

### 2026-11-11 — Compact snapshots build selectors on demand (T045)
- **Decision**: `getPageState(page, { selectors: false })` (what the server passes for the compact format) builds no selector for listed elements. A ref entry holds the element handle and the row facts; `resolveRef` builds the selector with `buildSelector` on first use, verified by element identity, and keeps it. Candidates are one array handle in the page; element handles are taken for the listed rows only.
- **Why**: on a page with 4,330 candidates a snapshot took 19–31 s: about 300 `page.locator` round trips at 90–120 ms each to verify selectors the compact reply never prints, plus 2.6 s for a handle per candidate. After: about 0.5 s.
- **Consequences**: in the compact mode a ref follows the listed node, so a re-ordered identical sibling still resolves (eager mode: stale). `format: "full"` (default `selectors: true`) is unchanged, still uses `page.$$`, and stays slow on huge pages. The in-page candidate walk copies Playwright's order through open shadow roots (own children before the shadow tree); a test pins it against `page.$$eval`.

### 2026-11-11 — Snapshot scope is opt-in: `viewport` and `within` (T043)
**Decision**: `ui_get_page_state` accepts `viewport: true` (elements whose rect intersects the viewport now) and `within` (a selector or ref of exactly one element; lists its descendants). Scoping is a filter in the page-wide read pass, applied before the 200 cap; a scoped reply that left elements out carries a note with shown/total counts. `overlays`, `focused` and `messages` are never scoped. With neither argument the reply is unchanged (only the cap note's wording now names the two arguments).
**Why**: content-heavy pages still cost 1,000–1,600 tokens per snapshot after T040. Opt-in, not automatic, because an element missing from a list is a worse failure for an agent than a long list (1 of 21 baseline targets was off-screen). Measured: Wikipedia 54% of unscoped, Hacker News 67%.
**Trade-off**: saves nothing unless the agent asks; the tool list is at 19,362 of 20,000 characters. Revisit automatic scoping only with data from real agent runs.
**Files**: `src/tools/web.ts`, `src/server.ts`, `test/web.test.ts`, `test/multi-session.test.ts`, `README.md`, `site/index.html`

### 2026-11-11 — The tool list has a size budget: 20,000 characters (T041)
**Decision**: `test/health.test.ts` fails when `JSON.stringify` of the `tools/list` tools array exceeds 20,000 characters (19,017 after T041, 27,207 before). Shared rules are stated once: the `session_id` rule in `ui_start_session`, ref and `nth=` staleness in `ui_get_page_state`. Argument descriptions that only restate the name are gone.
**Why**: the tool list is paid in every conversation and was 76–83% of an app-style flow in the 2026-11-11 baseline. `tasks/TASK_GUIDE_T041.md` holds the 17 facts the descriptions must keep.
**Trade-off**: about 980 characters of headroom; a new tool or longer description must cut elsewhere or raise the budget on purpose.
**Files**: `src/server.ts`, `test/health.test.ts`

### 2026-11-11 — Page state is compact text with refs by default; refs are identity-checked aliases (T040)
**Decision**: `ui_get_page_state` replies with one text line per element (`@eN role "name" state`, `overlay @oN …`, `focused:`, `messages:`); `format: "full"` returns the earlier JSON with selectors and no refs. A ref is an alias for the verified selector of the latest snapshot of that page (`WeakMap<Page, …>` in `web.ts`), resolved once in `registerSessionTool` for `selector` / `from` / `to` / `container`. Resolution checks that the selector still matches exactly the stored element handle; otherwise the call is refused and recorded as a **soft** step. Every snapshot ends the earlier refs, a `format: "full"` one included.
**Why**: the 2026-11-11 baseline (`docs/experiments/token-baseline-2026-11-11.md`) showed selectors and JSON keys were most of the reply. Measured on four flows: 1,413 → 807, 2,092 → 1,169, 26,192 → 4,871, 27,086 → 5,483 tokens. The user approved compact-by-default, refs invalidated per snapshot, viewport scoping later. A refused ref is soft because it says nothing about the app under test.
**Trade-off**: selectors are still built per snapshot (no speed gain); pages that re-render nodes make refs stale and cost an extra snapshot; the tool list (6,802 tokens) is now the largest cost on app-style flows (T041).
**Files**: `src/tools/web.ts`, `src/server.ts`, `test/web.test.ts`, `test/multi-session.test.ts`, `README.md`, `site/index.html`, `docs/experiments/token-baseline.mts`

### 2026-10-30 — Vercel hosts a static docs page only; `requirements.txt` renamed (T025)
**Decision**: Vercel serves `site/index.html` (one self-contained Graphite Mint docs page, no JS) via `vercel.json` with `framework: null`, empty install/build commands and `outputDirectory: "site"`. The planning prose that sat at `requirements.txt` is now `docs/original-plan.md`. `test/site.test.ts` pins the config, the tool list, the tokens and self-containment.
**Why**: the user's Vercel deploy failed because Vercel treats a root `requirements.txt` as Python deps and ran `uv pip install` on prose. The MCP server itself can't run on Vercel (long-lived process holding Chromium, Docker image, local `reports/` disk), so the user chose a docs page like https://personal-agentic-claude.vercel.app/. Serving only `site/` keeps `reports/`, `src/` and `memory/` off the public site.
**Trade-off**: the docs page restates README/RUNBOOK by hand; only the tool list is drift-tested. Never add a root `requirements.txt` again.
**Files**: `vercel.json`, `site/index.html`, `test/site.test.ts`, `docs/original-plan.md`, `README.md`

### 2026-10-30 — `reports/index.html` follows the Graphite Mint design system (T024)
**Decision**: The report index uses Graphite Mint, the Easy Kit family's dark design system (https://claude.ai/artifact/7DkuKJzMN6tJ9S8v2fNE8b). It follows the system's StatStrip and DataTable patterns: exact token values are inlined as CSS custom properties on `:root`, and component rules are copied from its `bundle.css`. Neon is used only on the eyebrow and the key number, and status is a plain mono word (`failed` in `warn`).
**Why**: the user asked for the page to match the Easy Kit family. Inlining keeps the report self-contained (FR-005). Tests forbid raw colours outside `:root` and pin each token to its design-system value, so the look can't drift silently.
**Trade-off**: IBM Plex is not bundled, so pages render in system fallback fonts.
**Not yet**: the per-session report (`renderHtml`) is still in the T014 light style.
**Files**: `src/reports/index.ts` (`renderIndex`, `INDEX_CSS`), `test/reports.test.ts`

### 2026-10-30 — Web agent ergonomics: page state carries verified selectors; one tool per interaction verb (T017–T022)
**Decision**: `ui_get_page_state` returns `{role, name, selector}` per element, plus `messages` (alert/status text). Names use an ordered accessible-name lookup: aria-label > aria-labelledby > label > text > placeholder > title > value (button inputs only). Every `selector` is chosen from `[data-testid]` > `#id` > `role=…[name=…]` > `… >> nth=i` and **verified by element identity** on the live page before it is returned. Five new primitives exist, each a separate tool: `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`. Reports are named `session-<UTC stamp>-<slug>-<id8>`, and `reports/index.html` is rewritten after every report (best effort, never fails the report). `npm test` runs files sequentially (`--test-concurrency=1`), because two test files bind the hard-coded port 8765.
**Why**: the user's goals (2026-10-30) were "executable, simple as is, easy for the agent to drive, readable results". Agents were guessing CSS selectors, and could not see inputs or error messages. Identity verification means hostile page text can only cause a fall-through, never a wrong click. One tool per verb (not a multiplexer) matches the existing vocabulary.
**Rejected**: server-side element ref maps (stateful, invalidation rules); `page.accessibility` snapshot (deprecated, no DOM handle); a sidecar sessions log for the index (second source of truth).
**Files**: `src/tools/web.ts`, `src/server.ts`, `src/reports/index.ts`, `test/*.test.ts`, `package.json`

### 2026-07-01 — Primitive Playwright tools + explicit session bracketing (no server-side LLM)
**Decision**: The MCP server exposes low-level Playwright action tools (`ui_navigate`, and in T002+: `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`). The calling agent (Claude Code) reasons over natural-language flows itself, step by step. No LLM call happens inside the server.
**Why**: Avoids server-side LLM credentials/cost, keeps the server deterministic and debuggable, matches the proven `playwright-mcp` tool shape. See `BRAINSTORMING_LOG.md` Option A.
**Files**: `src/tools/web.ts`, `src/server.ts`

### 2026-07-01 — MCP transport is HTTP/SSE (StreamableHTTPServerTransport), not stdio
**Decision**: Server runs as a persistent Docker service exposing MCP over HTTP/SSE on `localhost:8765`, using the MCP SDK's `StreamableHTTPServerTransport` with session-per-connection keyed by the `mcp-session-id` header.
**Why**: Cleaner fit for an always-on Docker service than a stdio bridge — Claude Code connects directly to the running container, no local spawn/bridge process needed.
**Files**: `src/server.ts`
**Update 2026-11-10 (T038)**: HTTP stays the default and the local/Docker path. A second entry, `src/stdio.ts` (`dist/stdio.js`), serves the same tools over stdio for hosts that wrap a stdio server, such as Glama's `mcp-proxy`. It sets `EASY_UI_MCP_NO_HTTP` before importing `server.js`, so nothing binds 8765.

## Infrastructure

### 2026-07-01 — Docker base image pinned to exact Playwright version match
**Decision**: `Dockerfile` uses `mcr.microsoft.com/playwright:v1.61.1-jammy`, and `package.json` pins `"playwright": "1.61.1"` (exact, not `^1.61.1`).
**Why**: The Docker image's baked-in Chromium version must match the `playwright` npm package's expected browser version exactly — a floating semver range would let `npm install`/`npm ci` silently pull a newer `playwright` package whose browser version drifts from what's actually installed in the image, breaking automation in a way that's hard to diagnose. Use `npm ci` (not `npm install`) in the Dockerfile to enforce the lockfile.
**Files**: `Dockerfile`, `package.json`

### 2026-07-01 — All primitive tools use a "no active page" guard consistently
**Decision**: `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot` all use the `currentPage()` accessor (returns `undefined` if `ui_navigate` hasn't run yet, never auto-creates a page) and return a clean `"No active page — call ui_navigate first"` error when called too early. Originally `ui_click`/`ui_fill` used `getPage()` (auto-creates a blank page) — found and fixed during T002 code review.
**Why**: Consistent, predictable failure mode across all primitive tools — an agent calling any tool before `ui_navigate` gets the same clear signal, not a confusing "no element matched" from a blank page.
**Files**: `src/server.ts`, `src/tools/web.ts`

### 2026-07-01 — MCP SDK HTTP/SSE transport spike: PASSED
**Decision**: Confirmed via a standalone spike (T001) that the MCP SDK's `StreamableHTTPServerTransport` works cleanly embedded in a single long-lived Express process — `initialize` handshake returns a session ID header, `tools/call` works keyed off that session, `/health` stays independently responsive mid-session. No custom transport or workaround needed.
**Why**: This was the Medium-risk unknown flagged in `PROJECT_SPEC.md` Known Risk Areas before T001 started — resolved, no longer a risk for T002+.
**Files**: `src/server.ts`

### 2026-07-09 — v2 Android: Appium reaches an external device only, no bundled AVD (T006)
**Decision**: `Dockerfile` installs `android-tools-adb` (platform-tools only) via `apt-get`, not a full Android SDK or AVD/emulator. `package.json` adds `appium` (2.11.4) and `webdriverio` (9.4.3) as exact-pinned runtime `dependencies` (same pinning style as `playwright`). The container connects to an emulator/device running externally (on the host or LAN) over ADB — confirmed by the user during Stage 0.5 brainstorming (`BRAINSTORMING_LOG_android.md` Option C).
**Why**: Keeps the image lean and avoids bundling a full Android SDK + nested-virtualization emulator inside Docker. The existing `network_mode: host` fix (already applied for v1 web-target reachability) turns out to solve ADB reachability too, for free, on Linux — the container's `adb` auto-discovers a host-side AVD on `127.0.0.1:5554+` with zero extra config.
**Files**: `Dockerfile`, `package.json`, `AGENTS.md`

### 2026-07-09 — Appium's `postinstall` does not auto-install a driver (uiautomator2 required for T007)
**Decision**: `appium@2.11.4` ships a `postinstall` script (`autoinstall-extensions.js`) that runs on every `npm ci`, but it does **not** install any driver by default — `appium driver list --installed` returns empty right after install. T007 (Appium session lifecycle) must explicitly install the `uiautomator2` driver, either baked into the `Dockerfile` (recommended, for parity with how Playwright's browsers are already baked in) or lazily on first `android_start_session`.
**Why**: Found during T006's Stage 4 code-review (P2 finding) — would otherwise have silently blocked T007 with an opaque "no driver" error at runtime.
**Files**: `Dockerfile`, `package.json`, `tasks/TASK_GUIDE_T007.md`

### 2026-08-17 — Soft vs hard action outcomes become the core session semantic (T013)
**Decision**: `recordAction` no longer collapses `ok`/`passed` into one boolean. `isFatalOutcome(entry)` in `src/tools/session.ts` is the single predicate deciding whether an action fails the session. `ui_check` records a falsy condition as a soft check (session stays `passed`, no auto-screenshot); `ui_assert` keeps its hard-fail meaning byte-for-byte; `ui_wait_for` polls and is hard only on timeout. A condition that cannot *run* (no page, expression throws) is always hard, for all three.
**Why**: Agents polled with `ui_assert` while waiting for render, permanently reddening sessions whose functional steps all passed (7 recorded sessions in `orderly/smoke-reports/`). The fix is additive-only — reinterpreting `ui_assert` would silently change what every existing report means.
**Files**: `src/tools/session.ts`, `src/server.ts`, `src/tools/web.ts`, `src/reports/index.ts`

### 2026-11-10 — T029–T034 merged to main; parallel batch integrated by merge, not rebase
**Decision**: The browser-action audit batch (T030 page state + `ui_get_text`, T031 click-outside + held native dialogs, T032 viewport/device/typing/history/scroll/screenshots, T033 logs/HTTP errors/tabs/upload/drag/downloads) was merged after T029 (multi-session) in order T030 → T031 → T032 → T033, each with `git merge --no-ff --no-commit` and its T029 conflicts resolved inside the merge (every session tool registers through `registerSessionTool`; per-call session via `callSessionId()`; `startSession(target, timeoutMs, onIdle, { holdDialogs, settings, reportsDir, limits })`). 26 tools. Rebase was impossible: the merge gate blocks `git rebase` while any task is on the board. T034 then committed the Easy Kit harness sync and aligned the harness tests. Full `npm test` 302/302.
**Why**: user ran `[admin]` then "you do all the merge"; every branch passed an independent live re-verify before merging (T030 and T031 each failed one first — hidden-text read; REST dialog hang and beforeunload Stay).
**Source**: PROJECT_KANBAN.md T029–T034 rows; tasks/TASK_REVIEW_T030–T033.md.

### 2026-11-10 — Docs site follows the Easy Kit family page pattern (T036)
**Decision**: `site/index.html` matches the family sites (easy-kits, easy-verifier, easy-memory, easy-personal .vercel.app): IBM Plex Sans/Mono from Google Fonts (the only external stylesheet the site test allows), header = icon tile + "Easy UI" + mono chip + bordered GitHub button, `// overview|guide|reference` sidebar with an outlined active pill, hero with tagline/title/2 buttons/3 tiles, and visual sections (flows, tool-map chips, before/after, measured bars) with prose under "More detail". Easy Kit's URL is https://easy-kits.vercel.app/ (the old personal-agentic-claude URL is banned by the site test). Charts use only recorded numbers with their source task named. The current-site dot glows with `--glow-dot: 0 0 8px #3cf5a8` (T037) — the only box-shadow the site test allows.
**Why**: user asked for a more visual page in the family style, 2026-11-10.
**Source**: tasks/TASK_GUIDE_T036.md, tasks/TASK_REVIEW_T036.md.

### 2026-11-11 — Positioning: a local UI-testing MCP with evidence, not a browser controller (T039)
**Decision**: README, `site/index.html` and the `package.json` description lead with "a local UI-testing MCP that gives your agent structured, shareable test reports". Docs carry six points: structured reports, testing primitives (`ui_start_session`/`ui_step`, `ui_assert` vs `ui_check` vs `ui_wait_for`), a verdict you can trust (Browser problems), local-first, no LLM inside, made for Claude Code (HTTP/SSE plus the stdio entry). The site has a `#why-easy-ui` section after the hero; `test/site.test.ts` checks it.
**Why**: user pasted a positioning note 2026-11-11 and asked the docs to highlight what was built. Each claim was checked against the code. Nothing is said about other products, because that was not verified. Android is on hold, so docs must not imply `android_*` tools exist.
**Source**: tasks/TASK_GUIDE_T039.md.

### 2026-11-12 — README is the short pitch; the detailed guide lives on the docs page (T046)
**Decision**: `README.md` holds the positioning line, the problem, why to use it (7 rows), Quick Start, one line naming every tool, a short stdio note and links (44 lines, pinned at <= 60 by `test/site.test.ts`). Every reference detail the old README carried is on `site/index.html`, which gained `#stdio`, `#scope` and `#more-docs`. Guide links from the README are absolute (`https://easy-ui-mcp.vercel.app/#id`) because GitHub and npm cannot follow `site/` links; a test checks each id exists on the page.
**Why**: user, 2026-11-12: make the README simpler, focused on the problem and why to use it, with the detail guide on the index page. The one-line tool list stays because `test/docs-tools.test.ts` makes the README name every registered tool, which catches a tool added without docs.
**Source**: tasks/TASK_GUIDE_T046.md, tasks/TASK_REVIEW_T046.md.
