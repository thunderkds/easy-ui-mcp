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
