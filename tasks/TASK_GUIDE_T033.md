# TASK_GUIDE — T033: Debug and multi-page — logs, HTTP errors, tabs, upload, drag, downloads
**Date**: 2026-11-10
**Complexity Level**: C2
**Risk Level**: Medium
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `memory/codebase-map.md` if present
7. Read `BRAINSTORMING_LOG_browser-actions.md` — rows F4, F5, E2, C5, A7, E4

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-11-10): check every action an agent needs to test and debug a flow. The audit found:
- Console errors, page errors and failed requests are captured (`src/tools/session.ts:139`), but only into the final report. The agent can't read them mid-flow to see why a button "did nothing".
- HTTP 4xx/5xx responses are not captured at all. Playwright's `requestfailed` fires only on network-level failures, and a 500 counts as a successful request.
- `target=_blank` links and OAuth/payment popups open a new page that the session never sees.
- No file upload (deferred in T019).
- No drag-and-drop: kanban boards, sortable lists, sliders.
- Downloads ("Export CSV") are ignored.

**Restated intent**:
> The agent can ask the browser what went wrong (console, errors, failed HTTP calls) while the flow runs, follow and switch between tabs, upload files, drag things, and confirm a download happened.

**Out of scope**:
- iframes, auth reuse, network mocking, clock, accessibility tree, `ui_evaluate` (later)
- Uploading any file other than the built-in `default_draft.png` (D1)

**Requirement Refs**:
- FR-018: console/page/network capture (extended to HTTP ≥ 400 and readable mid-flow)
- FR-025 (new, added by this task): `ui_get_logs`, tab tracking/switching, file upload, drag-and-drop, downloads
- US-002, US-004

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed by the user (2026-11-10)
- [x] Decision D1 answered by the user (2026-11-10)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] FR-025 added to `PRD.md` and covered by the Acceptance Criteria

### Decisions

| # | Question | Answer |
|---|----------|--------|
| D1 | Which file(s) may `ui_upload_file` upload? | **One built-in file only** (user, 2026-11-10: "just create a default_draft, and we just use this file only"). `assets/default_draft.png` ships in the image. The tool takes **no path**, so the agent can never send any other container file to the site under test. |

---

## Dependencies & Reachability

**Depends on**: none. **Soft**: T031 (dialogs on popups use the same listener).
**Coordinate with**: T029 (multiple sessions). Tabs belong to one session. New tools take the optional `session_id` if T029 has merged. **T029 and T033 both change how a session's "current page" is resolved, so merge T029 first if both are open.**

**Entry point**: MCP tools `ui_get_logs`, `ui_tabs`, `ui_upload_file`, `ui_drag`; download capture in the session

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | Session capture adds `httperror` issues for responses with status ≥ 400: `<status> <METHOD> <url>`; still report-only, never fails the session (FR-018) | failed HTTP calls |
| 2 | `ui_get_logs(since?: "start"|"last")` returns the session's captured issues; default `last` = only issues since the previous `ui_get_logs` call; capped at 50 lines with a truncation note; console `warning`s included when `level: "warning"` is passed | read errors mid-flow |
| 3 | New pages opened in the context (`target=_blank`, `window.open`) are tracked; the next tool response says `New tab opened: <url> (tab 2)` | follow popups |
| 4 | `ui_tabs(action: "list"|"switch"|"close", index?)`: `list` returns index/url/title/current; `switch` makes that tab the page every tool acts on; `close` closes it and falls back to the previous tab; closing the last tab → `isError` | switch tabs |
| 5 | Issue/console/dialog listeners attach to every tracked tab; `ui_end_session` closes all tabs | consistent capture |
| 6 | `ui_upload_file(selector)` (no path argument) uploads `assets/default_draft.png` to the single `input[type=file]`, or to the file chooser opened by clicking the element (custom "Upload" buttons with a hidden input). The response and report name the file (`default_draft.png`, size). If the input's `accept` excludes images, the response warns that the app may reject the file | upload |
| 7 | `ui_drag(from, to)` drags the single `from` match onto the single `to` match (`locator.dragTo`); works on an HTML5 drag-and-drop list and a pointer-events sortable fixture | drag and drop |
| 8 | Downloads are captured: saved under `reports/downloads/<session>/`, logged as an action with file name and size; the next tool response names the file | confirm download |
| 9 | `describe()` covers every new action; the report lists HTTP errors with the other issues | readable report |
| 10 | Docs updated; the doc-drift test passes | agent guidance |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Local fixture server route returning 500; page fetches it and logs a console error | `ui_get_logs` shows both; second call with `last` is empty; session not failed | `test/session.test.ts` |
| 2 | Link with `target=_blank` | notice on the click response; `ui_tabs list` shows 2; `switch` then `ui_get_page_state` reads the new tab; `close` returns to tab 1 | `test/session.test.ts` |
| 3 | `input[type=file]` that prints the chosen file name and size; a hidden input behind a styled "Upload" button; an input with `accept=".csv"` | `default_draft.png` printed for both; the CSV input succeeds with the `accept` warning; the tool schema has no path field | `test/web.test.ts` |
| 4 | HTML5 DnD list A,B,C; drag A onto C | order changes | `test/web.test.ts` |
| 5 | Link with `download` attribute | file saved, size > 0, logged | `test/session.test.ts` |
| 6 | `describe()` for new actions | readable, escaped | `test/reports.test.ts` |
| 7 | Live: rebuilt container, Claude Code follows a `_blank` link and reads the logs on a page with a broken API call | both visible | Stage 5 `verify` |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/web.test.ts && node --import tsx --test test/session.test.ts && node --import tsx --test test/reports.test.ts && node --import tsx --test test/docs-tools.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T033.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T033.md`.

---

## Approach

**Brainstorming**: done — `BRAINSTORMING_LOG_browser-actions.md`, Option B, approved 2026-11-10.

**Pattern reference**:
- `attachIssueListeners()` in `src/tools/session.ts:139`: extend it for `response`, and call it for each new page from `context.on("page")`.
- `getSessionPage()` becomes "current tab".
- New tools use `runInteraction` + `onUniqueLocator` (T019).

**Vital slice**: HTTP ≥ 400 capture + `ui_get_logs`; tab tracking + `ui_tabs`; `ui_upload_file` with the built-in `default_draft.png`; `ui_drag`; download capture.
**Cut list**:
- Other `default_draft` formats (`.pdf`, `.csv`, `.txt`) picked by the input's `accept`. Add them only when a real app rejects the PNG
- Multiple files per upload
- iframes
- Response bodies in logs
- Drag by coordinates/offset
- Download content inspection

---

## Edge Case Checklist

- [ ] Upload file path is a server constant resolved from the app folder, never built from tool input
- [ ] `default_draft.png` stays tiny (a valid 1×1 or small PNG, < 5 KB) and contains no real data
- [ ] `ui_get_logs` output never includes request/response bodies or headers (may hold tokens)
- [ ] Query strings in logged URLs truncated (may hold tokens) — same as existing `requestfailed` handling
- [ ] Favicon 404s and other noise: keep them, but group repeats (`×N`)
- [ ] Popup that closes itself (OAuth) → current tab falls back automatically, with a notice
- [ ] Download with no suggested file name → safe generated name
- [ ] Legacy no-session page: tabs and downloads are session-only (documented)
- [ ] Issue cap `MAX_PAGE_ISSUES` shared across tabs

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/tools/session.ts` | `response` + `download` listeners, tab list + current tab, close all tabs |
| `src/tools/web.ts` | `uploadFile()` using the built-in file, `drag()` |
| `src/server.ts` | `ui_get_logs`, `ui_tabs`, `ui_upload_file`, `ui_drag`; notices for new tab/download |
| `src/reports/index.ts` | `describe()` cases, `httperror` issue kind |
| `assets/default_draft.png` | new: the only file `ui_upload_file` uploads (per D1) |
| `Dockerfile` | one line: `COPY assets ./assets` |
| `test/web.test.ts`, `test/session.test.ts`, `test/reports.test.ts`, `test/docs-tools.test.ts` | AC tests |
| `PRD.md` | FR-025 |
| `AGENTS.md`, `HARNESS.md`, `README.md`, `RUNBOOK.md`, `site/index.html` | tool list + count |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `isFatalOutcome` | logs and HTTP errors never fail a session by themselves |
| `docker-compose.yml` | no new volume needed; the file ships in the image |
| `Dockerfile` (beyond the one `COPY` line) | Playwright tag pin must stay in sync with `package.json` |
| `src/api/run-test.ts` | REST shape unchanged |

---

## Test Plan

Test-first. Use a small local HTTP fixture server inside the tests for the 500 response, the popup and the download, and tear it down per test (T022 teardown rule). Run the verification command, then a live drive on a spare port and on the rebuilt container.

---

## Completion Checklist

- [x] D1 answered (built-in `default_draft.png` only)
- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T033.md`
- [ ] Security review run (Medium risk) — upload takes no path from tool input, no secrets in logs
- [ ] Docs updated (AC 10), FR-025 in `PRD.md`
- [ ] Supervisor notified: task ready for Stage 4 review
