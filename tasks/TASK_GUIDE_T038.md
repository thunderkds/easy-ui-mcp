# TASK_GUIDE — T038: stdio entry point so Glama's `mcp-proxy` can run easy-ui-mcp
**Date**: 2026-11-10
**Risk Level**: Medium (touches shared `src/server.ts`; adds a new process entry and transport)
**Assigned agents**: common-infrastructure (worktree/env), backend-developer (implement, test-first), qa-expert (independent verify)

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `PROJECT_SPEC.md`, `BRAINSTORMING_LOG_stdio-glama.md`, `src/server.ts`, `memory/MEMORY.md` and this guide.)

## Requirement
User, 2026-11-10: run the server on Glama. Glama's generated image starts `mcp-proxy -- <cmd>`, which wraps a **stdio** MCP server. Today `node dist/server.js` only speaks Streamable HTTP, so the proxy ignores the `listening on http://localhost:8765` banner and fails with `REQUEST_TIMEOUT` (60 s) waiting for an `initialize` reply over stdio.

Add a stdio entry (`dist/stdio.js`) without changing anything about local HTTP use.

## Decision
Option B of `BRAINSTORMING_LOG_stdio-glama.md`, approved by the user 2026-11-10: export `buildMcpServer`, skip `app.listen` and the SIGTERM handler when `EASY_UI_MCP_NO_HTTP` is set, and add `src/stdio.ts`. Do **not** move the factory (it would break `test/docs-tools.test.ts`, which scans `src/server.ts` for literal `registerTool` calls).

## Acceptance Criteria
- [ ] `src/server.ts` exports `buildMcpServer`; with `EASY_UI_MCP_NO_HTTP` unset, behaviour is byte-for-byte the same as before (listens on 8765, `/health`, `/mcp`, `/api/run-test`, SIGTERM closes the browser).
- [ ] With `EASY_UI_MCP_NO_HTTP` set, importing `server.ts` binds no port and registers no SIGTERM handler.
- [ ] `src/stdio.ts` sets the flag **before** importing `./server.js` (dynamic `await import`), connects `buildMcpServer()` to `StdioServerTransport`, and logs only to stderr. Stdout carries JSON-RPC only.
- [ ] Over stdio, `initialize` then `tools/list` succeeds and returns the same tool names as the HTTP server.
- [ ] When stdin closes, owned sessions end (existing `onclose` cleanup), Chromium closes, and the process exits 0. SIGTERM in stdio mode closes the browser and exits.
- [ ] `test/stdio.test.ts` (new) covers: handshake + tools/list, stdout is pure JSON-RPC, port 8765 not bound (runs fine while another server holds it), exit on stdin close. Written first and seen red.
- [ ] `test/docs-tools.test.ts` and every other existing test pass **unmodified**. Full `npm test` 0 failures. `npm run build` emits `dist/stdio.js`.
- [ ] README or RUNBOOK: one note giving the Glama start command `mcp-proxy -- node dist/stdio.js` and the build command `pnpm install && pnpm build && pnpm exec playwright install --with-deps chromium`.

## Edge Case Checklist
- [ ] Flag unset: `node dist/server.js` still listens and `/health` returns ok
- [ ] Flag set: nothing binds 8765, stdio can run next to the Docker container
- [ ] Dynamic import: flag set before `server.js` top level runs (static imports hoist)
- [ ] Nothing writes to stdout (the only `console.log` in `src/` is the listen banner, line ~1220; keep it HTTP-only)
- [ ] stdin close → sessions ended, reports written, browser closed, exit 0 (the browser keeps the event loop alive, so exit explicitly)
- [ ] SIGTERM in stdio mode closes the browser and exits
- [ ] Chromium missing: tool calls return a clear error, the server still starts and lists tools
- [ ] The legacy shared `page` is process-global: acceptable for a single stdio connection; note it in the doc

## Files to change (predicted)
| File | Change |
|------|--------|
| `src/server.ts` | `export` on `buildMcpServer`; gate `app.listen` + SIGTERM handler on the flag (~6 lines) |
| `src/stdio.ts` | new stdio entry (~25 lines) |
| `test/stdio.test.ts` | new |
| `README.md` or `RUNBOOK.md` | Glama start/build command note |

## Files must NOT touch
| File | Reason |
|------|--------|
| `src/tools/*`, `src/reports/*`, `src/api/*` | no behaviour change needed |
| `Dockerfile`, `docker-compose.yml` | local/Docker flow unchanged |
| `test/docs-tools.test.ts` | must pass unmodified (proof the `registerTool` scan is intact) |
| `package.json` | no new dependency (`@modelcontextprotocol/sdk` already ships `server/stdio.js`) |

## Test plan
`test/stdio.test.ts` spawns `node --import tsx src/stdio.ts` (same pattern as `test/multi-session.test.ts:151`), talks JSON-RPC on stdin/stdout. Then the full suite. Note: `multi-session` and `api-run-test` need port 8765 free; stop the Docker container first.

## Verification Command
```
node --import tsx --test test/stdio.test.ts && npm run build && ls dist/stdio.js && npm test
```
Live check at Stage 5 (verify): HTTP `/health` on the unchanged path, plus a real stdio handshake against the built `dist/stdio.js`.

## Out of scope (cut list)
Glama-side config and pinned SHA (user does it after merge); a Docker image change; Android/Appium tools under stdio.

## Completion checklist
- [ ] Implementation done
- [ ] Lint/tsc passes
- [ ] Tests pass
- [ ] Smoke test confirmed
- [ ] `docs/legacy/` updated (n/a — none)
- [ ] `memory/` updated (Supervisor only)
- [ ] KANBAN updated
- [ ] TASK_GUIDE marked complete

## Demonstration
**BEFORE**: Observed on Glama 2026-11-10T10:41–10:42 (image built from `main`, start `mcp-proxy -- node dist/server.js`): `[mcp-proxy] ignoring non-JSON output [ 'easy-ui-mcp server listening on http://localhost:8765' ]`, then `could not start the proxy SdkError: Request timed out` (`REQUEST_TIMEOUT`, 60000 ms), `transport event { type: 'close' }`. The proxy never got an `initialize` reply over stdio.
**AFTER**: _(fill at Stage 5: live stdio handshake against built `dist/stdio.js` returns the tool list; HTTP `/health` still ok)_
**DELTA**: _(fill at Stage 5)_
