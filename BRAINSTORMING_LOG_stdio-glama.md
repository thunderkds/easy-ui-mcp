# BRAINSTORMING_LOG.md
**Generated**: 2026-11-10
**Task / Context**: T038 — stdio entry point so `mcp-proxy` (Glama) can run easy-ui-mcp. Tier: Standard. Risk: Medium.
**Skill**: `Skill({ skill: "brainstorming" })`

---

## The Problem Space

Glama runs `mcp-proxy -- <cmd>`, which wraps a **stdio** MCP server. `src/server.ts` speaks only
Streamable HTTP and calls `app.listen(8765)` at import time. Observed on Glama (2026-11-10):
`easy-ui-mcp server listening on http://localhost:8765` is ignored as non-JSON, then
`REQUEST_TIMEOUT` after 60 s (no `initialize` reply over stdio).

Non-negotiable: local HTTP behaviour (`/mcp`, `/health`, `/api/run-test`, port 8765, Docker image) is unchanged.

### Verified facts (claim-verification gate, all checked in the repo)
- `buildMcpServer()` (src/server.ts:177) is **not exported**; module top level runs `app.listen` (1219) and a SIGTERM handler (1223).
- Session scope is **per `buildMcpServer()` call**: `ConnectionSessions`, `callContext` (AsyncLocalStorage) and `owned` are created inside the factory. It does **not** depend on the `mcp-session-id` header. One stdio process = one connection = one factory call. **The "key unknown" resolves cleanly.**
- `server.server.onclose` (line 201) already ends every owned session and writes reports, so stdin close from the proxy triggers cleanup for free.
- The only `console.log` in `src/` is the listen banner (line 1220); everything else uses `console.error`. Stdout is otherwise clean.
- `@modelcontextprotocol/sdk` ships `server/stdio.js` (no new dependency).
- Coupling that rules out moving the factory: `test/docs-tools.test.ts:11` reads `src/server.ts` and scans it for literal `registerTool` calls; `test/multi-session.test.ts:151` and `test/api-run-test.test.ts` spawn `src/server.ts`.

---

## Questions for the User

1. Is it acceptable that on Glama the browser tools only work if Chromium is installed in the image (build step `playwright install --with-deps chromium`), or is a server that merely starts and lists tools (for Glama's inspection/score) enough for now?

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | The Extraction Path | Move factory + helpers (~1000 lines) into `src/mcp-server.ts`; `server.ts` keeps Express; new `stdio.ts` | High | ~1000 moved + ~25 new | Medium-High | |
| B | The Guarded-Export Path | Export `buildMcpServer`; skip `app.listen`/SIGTERM when an env flag says "no HTTP"; new `src/stdio.ts` sets the flag, dynamic-imports `server.js`, connects stdio | Low | ~6 changed in server.ts + ~25 new | Low | ✅ Yes |
| C | The Minimalist Path | Env switch inside `server.ts` (`MCP_TRANSPORT=stdio` → stdio, else HTTP); no new file | Low-Medium | ~12 in server.ts | Low-Medium | |

### Option A — Extraction
**Approach**: pure cut-and-paste of lines ~1–1163 into a new module.
**Pros**: cleanest end state; no import side effects.
**Cons**: moves `browser`/`page`/`getPage`/`TOOL`/`interruptedReplies` module state; huge diff to review.
**Why it might fail**: `docs-tools.test.ts` scans `src/server.ts` and would find zero tools (suite red, or silently passing if the scan is loosened); spawn-based tests still pass, hiding module-state mistakes; violates Surgical Changes.

### Option B — Guarded export + `stdio.ts`
**Approach**: in `server.ts`, `export function buildMcpServer` and wrap `app.listen` + the SIGTERM handler in `if (!process.env.EASY_UI_MCP_NO_HTTP)`. `src/stdio.ts`: set the flag, `await import("./server.js")` (dynamic, so the flag is set before module top level runs), `new StdioServerTransport()`, `buildMcpServer().connect(...)`, plus its own SIGTERM and "close → close browser → exit".
**Pros**: server.ts keeps every literal `registerTool`; spawn tests unaffected; local runs take the same path as today (flag unset). New code is isolated in one new file.
**Cons**: an env flag in the hot file; module top-level still builds the Express `app` (harmless, never listens).
**Why it might fail**: forgetting the dynamic import (static imports hoist, `listen` would run first and bind 8765 in the proxy container); stdio process not exiting after the proxy closes stdin because the browser keeps the event loop alive; anything writing to stdout.

### Option C — Env switch inside server.ts
**Approach**: at the bottom, `if (process.env.MCP_TRANSPORT === "stdio") {…connect stdio} else {app.listen…}`.
**Pros**: no new file; start command would be `MCP_TRANSPORT=stdio node dist/server.js`.
**Cons**: Glama's start command must carry an env prefix (fragile in the generated `CMD ["mcp-proxy","--",…]` form, needs `env` wrapper); two transports live in the hot file; no isolated place to test stdio.
**Why it might fail**: Glama's CMD is exec-form, so `MCP_TRANSPORT=stdio` does not work unless wrapped in `env`; a typo silently starts HTTP and reproduces today's timeout.

---

## 50% Rule Check

Option B is already the cut-down form. Halving it: drop the SIGTERM/close handling in `stdio.ts` and rely on process exit. Rejected: without it an orphaned Chromium can outlive the proxy (the same leak `onclose` was written to prevent). Keep it, but reuse the existing `onclose` cleanup and add only "exit after close".

---

## Recommended Path

**Option B — Guarded-Export Path.**

Smallest diff to the hot file, keeps both test couplings intact, keeps local behaviour identical when the flag is unset, and gives stdio its own testable file. Glama start command becomes `mcp-proxy -- node dist/stdio.js` (no env prefix needed).

---

## Surgical Scope

Files that **should** be touched:
- `src/server.ts` — `export` on `buildMcpServer`; gate `app.listen` + SIGTERM behind the env flag (~6 lines)
- `src/stdio.ts` — new: stdio entry
- `test/stdio.test.ts` — new: spawn `src/stdio.ts`, MCP `initialize` + `tools/list` over stdio, assert stdout carries only JSON-RPC, assert port 8765 is not bound, assert process exits on stdin close
- `README.md` / `RUNBOOK.md` — one note on the Glama start command

Files that **must not** be touched:
- `src/tools/*`, `src/reports/*`, `src/api/*` — no behaviour change needed
- `Dockerfile`, `docker-compose.yml` — local/Docker flow unchanged
- `test/docs-tools.test.ts` — must keep passing unmodified (proof the registerTool scan is intact)

---

## Edge Case Checklist for TASK_GUIDE

- [ ] Flag unset: `node dist/server.js` still listens on 8765 and `/health` returns ok (local path unchanged)
- [ ] Flag set (via stdio.ts): nothing binds 8765, so stdio can run alongside the Docker container
- [ ] Dynamic import: the flag is set before `server.js` module top level runs
- [ ] Stdout carries only JSON-RPC frames (no banner, no library logging); diagnostics go to stderr
- [ ] stdin closed by the proxy → sessions ended, reports written, Chromium closed, process exits 0
- [ ] SIGTERM in stdio mode closes the browser and exits
- [ ] Legacy shared `page` is process-global: fine for one stdio connection, note it in the doc
- [ ] `tools/list` over stdio returns the same tool names as HTTP
- [ ] Chromium missing in the image: tools return a clear error, the server still starts and lists tools
- [ ] `npm test` full suite and `docs-tools.test.ts` unmodified and green; `tsc` build clean (`dist/stdio.js` emitted)

---

## Next Actions

1. Create `tasks/TASK_GUIDE_T038_stdio-entry.md` (Medium, agents: common-infrastructure, backend-developer, qa-expert).
2. Add T038 to `PROJECT_KANBAN.md`.
3. Spawn backend-developer test-first: stdio test red, then implement.
4. Stage 4 code-review (+ security-review: new process entry, stdout/stdin trust boundary), Stage 5 verify (live stdio handshake and live HTTP `/health`).
5. After merge: update Glama build/start commands and pinned SHA.

---

## User Selection

> **Approved direction**: Option B — Guarded-Export Path
> Approved by user on 2026-11-10.
