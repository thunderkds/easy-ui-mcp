# TASK_REVIEW — T021: Findable reports (readable filenames + reports/index.html)

> Sibling of `tasks/TASK_GUIDE_T021.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☒ pass | `test/reports.test.ts` (7 new T021 tests: slugify, naming + full id in JSON, same-second uniqueness, index ordering/legacy/corrupt/non-session skip/links, self-contained + escaping, index-write failure, 500 cap + truncation note) |
| Verification command run | ☒ pass | `node --import tsx --test test/reports.test.ts test/session.test.ts && npx tsc --noEmit` at Fri Oct 30 06:35:49 AM UTC 2026: `ℹ tests 53 / ℹ pass 53 / ℹ fail 0`, then `TSC_OK` (tsc exit 0, no output) |
| Negative cases hold | ☒ pass | corrupt `session-x.json`, `notes.json`, `screenshot-abc.png` not listed; `<script>` target escaped, slug `script-alert-1-script`; empty/symbol/CJK target -> `untitled`; `index.html` as a directory -> writeReports still resolves (error logged, tmp file removed) |
| verify | ☐ pass / ☐ fail / ☒ N/A | Not run by the implementer (Supervisor Stage 5). Implementer observation: generated a 5-session index in a temp dir via writeReports and rendered it in Chromium — pass |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☐ pass / ☐ fail | Pending reviewer. Changed only `src/reports/index.ts` + `test/reports.test.ts`; callers `server.ts` and `api/run-test.ts` use only the returned paths (unchanged contract) |
| Full smoke suite still green (no regression) | ☒ pass (with known pre-existing exception) | other test files: 24 pass / 2 fail; the 2 failures are `api-run-test` "report_url should point at a real file on disk", caused by a foreign server already listening on port 8765 (`ss -ltnp` shows `*:8765`) that the test hits instead of its own spawned one; noted in MEMORY.md as pre-existing, not related to this change |
| **UI: Visual regression (diff or verdict pasted)** | ☒ pass | `/home/hungnguyenhuu/workspace/pets/hungnguyen111/easy-ui-mcp/.claude/worktrees/agent-a862dc554a612db38/reports/evidence/T021/index-1280.png` and `index-375.png` (dir is gitignored via `reports/*`, so on disk only). Vision read: readable table, passed rows green with green bold "passed", failed rows red with red bold "failed", long target wraps, escaped `<b>` shown literally, Vietnamese target shown as-is |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☒ pass | Method: copied the `renderHtml` palette and font stack: `system-ui, sans-serif`, body max-width 60rem, border `#d0d7de`, pass `#eafaf1`/`#1a7f37`, fail `#fde2e2`/`#b91c1c`, other `#8a6d3b`. No new colours or design system |
| **UI: Responsiveness at target viewports** | ☒ pass | Playwright measured: 375px `documentElement.scrollWidth=375 == innerWidth=375` (no page-level horizontal scroll), `.table-wrap` scrollWidth 562 > clientWidth 343 (table scrolls inside its container; Status/Actions/Report columns reachable by scrolling); 1280px `scrollWidth=1280`, wrap 960 == 960 (full table visible, no scroll) |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured with the unmodified code, before any implementation commit; `npm ci` had been run first because the worktree had no node_modules):

```
$ date -u
Fri Oct 30 06:33:53 AM UTC 2026
$ node --import tsx before.mts <fresh-temp-dir>   # calls writeReports(sample record: target "Login flow / happy path", startedAt 2026-10-30T09:15:42Z)
$ ls <fresh-temp-dir>
session-3f2a9c1e-7b4d-4e8a-9a10-5d6c2b7e1f00.html
session-3f2a9c1e-7b4d-4e8a-9a10-5d6c2b7e1f00.json
```
Bare `session-<uuid>.*` names, no `index.html`. Context (same session, `date -u` = Fri Oct 30 06:33:41 AM UTC 2026):
```
$ ls /home/hungnguyenhuu/workspace/pets/hungnguyen111/easy-ui-mcp/reports | grep -c '^session-'
470
```

**AFTER** (same `writeReports` call on a 5-session temp dir, 2026-10-30 ~06:35 UTC; one legacy bare-uuid JSON plus four new sessions):

```
$ ls <temp-dir>
index.html
session-0a1b2c3d-1111-2222-3333-444455556666.json
session-20261028-120000-ang-nhap-thanh-cong-dddddddd.html
session-20261028-120000-ang-nhap-thanh-cong-dddddddd.json
session-20261029-174500-b-escaped-b-quoted-target-cccccccc.html
session-20261029-174500-b-escaped-b-quoted-target-cccccccc.json
session-20261030-080211-settings-page-change-a-very-long-display-bbbbbbbb.html
session-20261030-080211-settings-page-change-a-very-long-display-bbbbbbbb.json
session-20261030-091542-login-flow-happy-path-aaaaaaaa.html
session-20261030-091542-login-flow-happy-path-aaaaaaaa.json
```
Rendered index: `reports/evidence/T021/index-1280.png`, `index-375.png` in the worktree.

**DELTA**: A human can open the single `reports/index.html` to find any session (old or new) by start time, target and pass/fail verdict, and new report files are named by when and what they were instead of an opaque UUID.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/Txxx.jsonl`, never the
implementing agent alone]
