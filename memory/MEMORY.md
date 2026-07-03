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
