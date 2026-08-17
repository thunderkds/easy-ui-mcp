# decisions.md — Cold Tier: Architectural & Infrastructure Decisions

> **Rules**: Supervisor-only writes. Each entry: `### YYYY-MM-DD — Title`, then **Decision**, **Why**, and **Files** (cite paths — the diff-driven pass greps this file by changed file path).

## Architecture

### 2026-07-01 — Primitive Playwright tools + explicit session bracketing (no server-side LLM)
**Decision**: The MCP server exposes low-level Playwright action tools (`ui_navigate`, and in T002+: `ui_click`, `ui_fill`, `ui_assert`, `ui_get_page_state`, `ui_take_screenshot`). The calling agent (Claude Code) reasons over natural-language flows itself, step by step. No LLM call happens inside the server.
**Why**: Avoids server-side LLM credentials/cost, keeps the server deterministic and debuggable, matches the proven `playwright-mcp` tool shape. See `BRAINSTORMING_LOG.md` Option A.
**Files**: `src/tools/web.ts`, `src/server.ts`

### 2026-07-01 — MCP transport is HTTP/SSE (StreamableHTTPServerTransport), not stdio
**Decision**: Server runs as a persistent Docker service exposing MCP over HTTP/SSE on `localhost:8765`, using the MCP SDK's `StreamableHTTPServerTransport` with session-per-connection keyed by the `mcp-session-id` header.
**Why**: Cleaner fit for an always-on Docker service than a stdio bridge — Claude Code connects directly to the running container, no local spawn/bridge process needed.
**Files**: `src/server.ts`

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
