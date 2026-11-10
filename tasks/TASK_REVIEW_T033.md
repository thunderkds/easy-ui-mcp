# TASK_REVIEW — T033: Debug and multi-page

> Sibling of `tasks/TASK_GUIDE_T[NNN].md`. Everything here is **filled by the reviewer at Stage
> 4/5** — it is deliberately NOT in the guide, because the implementing agent re-reads the guide on
> every turn and never fills these two sections.
>
> Consumers resolve each section **guide first, this file second** (`.claude/hooks/lib/guide_sections.py`):
> a legacy guide that still carries these sections inline keeps working unchanged, and a stray
> review file can never override an inline section.

---

## Evidence

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/session.test.ts` (AC1-5, AC8), `test/web.test.ts` (AC6, AC7), `test/reports.test.ts` (AC9), `test/docs-tools.test.ts` (AC10) |
| Verification command run | ☑ pass | web 61/61, session 37/37, reports 42/42, docs-tools 1/1 (node:test, 0 fail); `npx tsc --noEmit` exit 0 |
| Negative cases hold | ☑ pass | 500 never fails the session (`passed`); closing the last tab is `isError`; unknown tab index, 0 or >1 selector matches, a click that opens no file chooser, and an unknown session all return clear errors; no path field in the `ui_upload_file` schema; query strings absent from log lines |
| verify | ☑ pass | independent re-drive of deaeb83, live MCP on port 28831 (2026-11-10T07:33Z): all-tabs-closed recovery ("All tabs closed; opened a blank tab", session `passed`), no `ERR_ABORTED` for attachment/octet-stream/`download` links, 30 MB file discarded (soft), 20-download cap (23 tried, 20 on disk, one limit line), 60 popups → 10 notices + "+50 more", relative `downloads/<id>/…` path, click wait div ~33 ms vs button ~185 ms; regressions clean (get_logs last/start, tabs, upload 79 bytes, drag, 500-only session `passed`). First review drive (57d0080, port 28811) also PASS on all ACs. New P3 (follow-up): a call landing within ms of the last tab closing still fails the session. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Reviewed: session.ts, web.ts, server.ts, reports/index.ts, their tests, docs-tools/site tests (tool count). Skipped: Android/Appium tools, `src/api/run-test.ts` (unchanged), `isFatalOutcome` (unchanged). Inline self-review only; the `code-review` and `security-review` skills were not run by the implementer |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` under the port lock: 163/164 on first run, the one failure (`site.test.ts` T025 AC9a, page said 16 tools) fixed in commit "docs(site): tool count 16 -> 20"; site + docs-tools re-run 14/14. A second full run after that fix was not repeated |
| **UI: Visual regression (diff or verdict pasted)** | ☐ N/A | no UI change (the docs page only gains four table rows and a count) |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☐ N/A | `test/site.test.ts` token tests still pass |
| **UI: Responsiveness at target viewports** | ☐ N/A | no layout change |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE**:
```
$ node --import tsx before.mts   (fixture server on port 0; page fetches /api -> 500, clicks a target=_blank link)
timestamp: 2026-11-10T04:44:51.513Z
tabs in context: 2 | session current page url: http://127.0.0.1:39801/ (still the first page; popup is not tracked or switchable)
issues captured (page fetched a 500): [{"timestamp":"2026-11-10T04:44:51.620Z","kind":"console","text":"Failed to load resource: the server responded with a status of 500 (Internal Server Error)"}]
httperror issue for the 500? false
session exports: getSessionLogs=false listTabs=false switchTab=false closeTab=false
```
Gap: no `httperror` issue (method/URL of the 500 is lost; only Chromium's URL-less console line), issues readable only in the final report, the popup tab exists in the context but the session cannot list or switch to it.

**AFTER** (live MCP drive against the changed server, temp copy on :18783, fixture on :18784; 2026-11-10):
```
> ui_get_logs {}
  console: save failed
  httperror: 500 GET http://127.0.0.1:18784/api/save?…
  console: Failed to load resource: the server responded with a status of 500 (Internal Server Error)
> ui_get_logs {}
  No new browser issues
> ui_click {"selector":"#l"}
  Clicked "#l"
  New tab opened: http://127.0.0.1:18784/popup (tab 2)
> ui_tabs {"action":"list"}
  [{"index":1,...,"title":"Home","current":true},{"index":2,...,"title":"Popup","current":false}]
> ui_tabs {"action":"switch","index":2}  -> Switched to tab 2 ; ui_get_page_state -> url .../popup
> ui_tabs {"action":"close","index":2}   -> Closed tab 2; now on tab 1
> ui_click {"selector":"#d"}             -> Clicked "#d" / Downloaded: export.csv (8 bytes)
> ui_upload_file {"selector":"#f"}       -> Uploaded default_draft.png (79 bytes) to "#f"
> ui_drag {"from":"#A","to":"#C"}        -> Dragged "#A" onto "#C"  (order now B,C,A)
> ui_end_session                         -> ended (passed)
```
tools/list shows 20 tools; the `ui_upload_file` input schema has only `selector`.

**DELTA**: An agent can now read a failed HTTP call (method, status, URL) and console errors while the flow runs, follow and switch between popup tabs, upload the built-in file, drag items, and confirm a download, none of which it could do before.

**WITNESS**: independent reviewer agent, 2026-11-10T07:33Z, live drive on port 28831 against deaeb83 (PASS); earlier independent drive 2026-11-10T06:14Z on port 28811 against 57d0080 (PASS on all ACs); Supervisor full `npm test` 170/170 at deaeb83, traced under T033.

---

## Decisions made during review fixes

- **Settle wait after `ui_click`**: the unconditional 150 ms wait is replaced by a wait only when the clicked element is, or sits inside, `a[target]`, `a[download]`, a button or a submit/button/image input (`mayOpenTabOrDownload`). Reason: racing an event against 150 ms still costs the full 150 ms in the common case where nothing happens, whereas this check costs one in-page evaluate; a popup or download from any other click is not lost, its notice rides the next response.
- **Download-abort noise**: a navigation that fails with `ERR_ABORTED` is not logged when its response was an attachment or `application/octet-stream` (checked from response headers; Playwright fires `requestfailed` about 1 ms before `download`, so filtering on the download URL would race).
- **Download caps**: 25 MB per file (deleted, soft action "Download too large, discarded") and 20 per session (first extra one is logged once, later ones are cancelled silently); set per session through `startSession`'s `limits` argument so tests use small caps.

## Auto decisions

Mode: auto
1. Resumed the dead T033 agent's uncommitted work instead of restarting the task — decided by the user in chat (2026-11-10, "I resume all four"), not by the Supervisor.
2. Stage 4 P2-1 (session unrecoverable once every tab closes), P2-2 (`ERR_ABORTED` noise per download), L1 (unbounded download size/count), the notice-flood P3 and L4 (absolute path in the report) fixed before Ready for Review — RULE: skills/code-review/SKILL.md:27 "P2 | Code quality, maintainability, non-critical test gap | Recommended".
3. P2-3 (tab errors are hard failures) kept as-is because a bad selector is already a hard failure; name collision, silent warnings cap, unredacted `ui_tabs list` URLs, close-message wording, path-token redaction (L2) and the prompt-injection note (L3) left as follow-up — RULE: skills/code-review/SKILL.md:28 "P3 | Style, minor improvement, documentation | Optional".
4. The 150 ms `ui_click` wait kept but limited to likely openers (`a[target]`, `a[download]`, buttons, submit inputs); racing events was rejected because the timeout is still paid when nothing happens — implementer's choice, recorded above under "Decisions made during review fixes"; Supervisor accepted it.
5. No rebase onto main@7cbe7a7: the gate blocks `git rebase` while any task is on the board, and the user chose to run the merges themselves — FACT: .claude/hooks/pre_bash_block_unsafe_merge.py:5 "Blocks git push/merge/rebase/pull commands if".
Checks: Supervisor full `npm test` 170/170 at deaeb83 (traced under T033); implementer web 62/62, session 42/42, tsc ok.
Memory: memory/learnings.md — "Playwright network events for downloads and HTTP errors arrive in an order you can't rely on (T033)"; memory/MEMORY.md — index line for it
Merge notes vs T029 (main@7cbe7a7): `startSession(target, timeoutMs, onIdle?, reportsDir?, limits?)` — keep main's idle machinery, update this branch's test calls; union the `Session` fields and strip both sides' extras in `toRecord`; replace main's single `attachIssueListeners(session)` with `trackPage(session, page)` plus the `context.on("page")` hook; register `ui_get_logs`, `ui_tabs`, `ui_upload_file`, `ui_drag` with `registerSessionTool(`; replace every `activeSessionId` with `callSessionId()` (in `withNotices`, the `ui_click` opener check, `ui_get_logs`, `ui_tabs`); keep main's `runInteraction`/`recordAction` plus this branch's function-valued `successText` and `withNotices`; union `TOOL` and imports; tool count 20; add a two-session popup/notice test.
Not done: merge into main (user runs it); rebuilt-container drive (SC 7, also proves the Dockerfile `COPY assets` line); independent live re-verify of deaeb83: PASS. Follow-ups: P3 race between the last tab closing and the replacement tab opening; the 25 MB check runs after `saveAs` (check Content-Length first); no tab cap.
