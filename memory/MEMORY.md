# MEMORY.md — Hot-Tier Memory Index

> **Rules**: Supervisor-only writes. Max 200 lines. One-line summaries + links to cold files.
> Injected in full into every sub-agent spawn prompt.
> Updated by the Supervisor — prompted by the PostToolUse hook on `git push` / `git merge` (diff-driven pass), or via the `/compact-memory` skill.

---

## Memory Architecture

- [decisions.md](decisions.md) — code + infra architectural decisions (the "why")
- [glossary.md](glossary.md) — canonical biz domain terms and core domain models
- [learnings.md](learnings.md) — specs/requirement clarifications, patterns, gotchas

---

## Index

<!-- Format: - [Title](cold-file.md#section) — one-line summary (≤150 chars) -->
- [Session-aware tools use `registerSessionTool`](learnings.md#gotchas) — plain `server.registerTool(` acts on no session; doc tests scan the literal call; onclose needs DELETE (T029)
- [stdio entry: close on stdin end, await onclose cleanup](learnings.md#gotchas) — SDK stdio transport ignores stdin EOF; `settleClosing()` before exit or reports are lost (T038)
- [Page state: compact text + identity-checked refs by default (T040)](decisions.md#architecture) — `@eN`/`@oN` resolve in `registerSessionTool`; refused ref is a soft step; `format: "full"` = old JSON and ends refs
- [Compact snapshots build selectors on demand (T045)](decisions.md#architecture) — `selectors: false` for compact; a ref's selector is built and identity-checked on first use; `format: "full"` still eager and slow on huge pages
- [Snapshot scope is opt-in: `viewport`, `within` (T043)](decisions.md#architecture) — filter before the 200 cap; note with shown/total; default reply unchanged
- [Tool list budget: 20,000 characters (T041)](decisions.md#architecture) — pinned in `test/health.test.ts` (19,362 after T043); shared rules stated once; a new tool must fit or raise it on purpose
- [Snapshot during an SPA re-render dropped every element (T042)](learnings.md#gotchas) — no load event on a route change; a pass now checks its handles are still connected and retries within 2 s
- [Token baseline script](learnings.md#gotchas) — `docs/experiments/token-baseline.mts`, `MODE=after`, `EASY_UI_SERVER_ROOT`; measures tool traffic of four fixed flows
- [Another session can advance main mid-task](learnings.md#gotchas) — re-check main before integrating; expect README/site conflicts; full `npm test` on the combined tree
- [Transport: HTTP default + stdio entry for hosted proxies](decisions.md#architecture) — `dist/stdio.js` for Glama `mcp-proxy`; `EASY_UI_MCP_NO_HTTP` skips listen (T038)
- [Primitive tools + session bracketing](decisions.md#architecture) — no server-side LLM; Claude Code drives Playwright step-by-step via MCP tool calls
- [MCP transport: HTTP/SSE](decisions.md#architecture) — StreamableHTTPServerTransport, session-per-connection, localhost:8765, not stdio
- [Docker↔Playwright version pinning](decisions.md#infrastructure) — mcr.microsoft.com/playwright tag must exact-match `playwright` npm pin; use `npm ci`
- [Transport spike: PASSED](decisions.md#infrastructure) — MCP SDK HTTP/SSE works in a long-lived Docker service, no workaround needed
- [Express JSON-parse error handler pattern](learnings.md#patterns) — always add one after `express.json()` or malformed bodies leak internal stack traces
- [Worktree agents need committed planning docs](learnings.md#gotchas) — commit PROJECT_SPEC.md/tasks/.claude/agents to main before spawning worktree-isolated agents
- [Worktree baseRef defaults to origin/main](learnings.md#gotchas) — set `.claude/settings.json` worktree.baseRef: "head" if commits aren't pushed to origin
- [Merge-gate verify regex, corrected](learnings.md#gotchas) — Check-cell must be exactly `verify`, AND the Notes cell must itself contain the word "pass"
- [No-active-page guard, consistent across all primitive tools](decisions.md#architecture) — ui_click/ui_fill/ui_assert/ui_get_page_state/ui_take_screenshot all fail clearly if called before ui_navigate
- [flow_description = session label, not parsed steps](learnings.md#patterns) — REST/tool NL fields label sessions only; no server-side LLM interpretation (T004 precedent)
- [npm test multi-file glob can hang in sandbox](learnings.md#gotchas) — not a code bug; verify live endpoint + run test files individually before concluding regression
- [Docs need independent re-verification](learnings.md#patterns) — cross-check every factual claim (e.g. ls for claimed files) rather than trusting the implementer's self-reported evidence
- [T001-T005 all merged to main, project v1 complete](decisions.md#architecture) — Docker+MCP server, 8 tools, sessions/reports, REST wrapper, docs
- [v2 Android: external device only, no bundled AVD](decisions.md#infrastructure) — adb (platform-tools only) + appium/webdriverio deps; T006 merged to main
- [Appium postinstall doesn't auto-install a driver](decisions.md#infrastructure) — uiautomator2 must be explicitly installed (Dockerfile or lazy) before T007 works
- [network_mode: host also solves ADB reachability](learnings.md#patterns) — same fix as v1 web dev-server reachability; Docker Desktop needs host.docker.internal fallback instead
- [network_mode: host port collision with orphaned local server](learnings.md#gotchas) — container binds host port directly; a stray `tsx src/server.ts` on 8765 causes a silent crash-loop, not a Docker/image bug — check `ss -ltnp`
- [Push gate fails closed on the whole board](learnings.md#gotchas) — any In Progress task or missing memory/event-trace/<TASK>.jsonl blocks every push; the Supervisor writes the trace by hand
- [Soft vs hard outcomes are now the core session semantic](decisions.md#architecture) — `isFatalOutcome` in session.ts decides failure; `ui_check` soft, `ui_assert`/`ui_wait_for` timeout hard (T013)
- [Report bloat was ONE large PNG, not duplicate captures](learnings.md#gotchas) — the brainstorm's stated mechanism was wrong; the real win is not capturing on soft failures (357KB → 4KB)
- [`npm ci` needed locally for T013](learnings.md#gotchas) — this repo normally only builds inside Docker; local test runs need deps installed first
- [Tests that build the value under test assert the fixture, not the behaviour](learnings.md#patterns) — logic in server.ts closures is unreachable from test/; extract it (T013 review)
- [tsx `__name` breaks in-page callbacks](learnings.md#gotchas) — no named inner functions in Playwright `$$eval`/`evaluate` callbacks when run via tsx (T017)
- [Gate hook matches the word "merge" in any Bash command](learnings.md#gotchas) — even `git merge-base` or a heredoc; trial-combine via cherry-pick in a throwaway worktree, write memory with Edit
- [MCP drive on a spare port](learnings.md#gotchas) — 8765 is hard-coded and owned by the user's container; verify with a temp server copy on 18766 + SDK client
- [Web agent ergonomics T017–T022 done (2026-10-30)](decisions.md#architecture) — page state has verified selectors + messages; 5 new primitives; readable report names + index.html; `npm test` sequential. Pushed to origin/main 2026-10-30 (99ad926)
- [Event-trace hook now wired](learnings.md#gotchas) — `post_tool_trace.py` registered 2026-10-30; records truncate at 300 chars, so keep test commands short (`cd <dir> && npm test`), set active_task in a separate call
- [Reports index uses Graphite Mint (T024)](decisions.md#architecture) — Easy Kit family design system (https://claude.ai/artifact/7DkuKJzMN6tJ9S8v2fNE8b); tokens inlined on `:root`, tests forbid raw hex outside it; per-session report not yet restyled
- [Doc-drift test guards tool lists (T023)](../test/docs-tools.test.ts) — every `registerTool` name must appear in README + RUNBOOK and RUNBOOK's "all N tools" must match; adding a tool means updating both docs
- [Vercel = static docs page only (T025)](decisions.md#architecture) — `vercel.json` serves `site/` with no install/build; root `requirements.txt` (prose) moved to `docs/original-plan.md` because Vercel read it as Python deps
- [`npm test` needs port 8765 free](learnings.md#gotchas) — stop the Docker container first; tests spawn their own server on the hard-coded port
- [`innerText` of hidden nodes is stale; `<summary>`/contenteditable have no Playwright role](learnings.md#gotchas) — check `isVisible()` before reading text; use `summary:text-is`/`[contenteditable][aria-label]` selectors (T030)
- [No `git rebase` while any task is on the board](learnings.md#gotchas) — parallel batches integrate by `git merge --no-ff <task branch>` into main, resolving conflicts in the merge (T030–T033)
- [Inline images: cap both sides; caps in device px; mask OTP/card text](learnings.md#gotchas) — 1280×8000 API limit, divide by DPR, mask by `autocomplete`/text-security and never echo typed text in reports (T032)
- [Download/HTTP-error events race in Playwright](learnings.md#gotchas) — `requestfailed ERR_ABORTED` fires before `download`: filter by headers; 500s only via `response`; reopen a tab when the last closes (T033)
- [Held dialogs: opt-in, and the agent is slower than action timeouts](learnings.md#gotchas) — hold only for `ui_start_session` (REST cannot answer); log a dialog-opening click as ok; soften only while pending (T031)
- [Harness lock covers `agents/`/`skills/`, not the `.claude/` symlinks](learnings.md#gotchas) — rebuild the lock from `git ls-files` after a kit sync; keep project policy guards in `docs/MULTI_AGENT.md`, not kit-owned AGENTS.md (T034)
- [T029–T034 merged to main 2026-11-10](decisions.md#architecture) — multi-session, page state/`ui_get_text`, dialogs/click-outside, viewport/device/typing, logs/tabs/downloads (26 tools); harness sync committed; `npm test` 302/302
- [Merge gate reads the board before a chained command runs](learnings.md#gotchas) — commit evidence and move the row in separate calls before `git merge` (T035)
- [Docs site follows the Easy Kit family pattern (T036)](decisions.md#architecture) — IBM Plex, icon-tile header, flows/charts from recorded numbers only; Easy Kit = https://easy-kits.vercel.app/
- [Positioning: local UI-testing MCP with evidence (T039)](decisions.md#infrastructure) — README/site/package lead with reports, testing primitives, trust, local-first, no LLM; no claims about other tools
