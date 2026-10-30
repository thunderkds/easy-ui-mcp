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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☒ pass | `test/reports.test.ts` (8 new T021 tests: slugify, naming + full id in JSON, same-second uniqueness, index ordering/legacy/corrupt/non-session skip/links, self-contained + escaping, index-write failure, 500 cap + truncation note, missing-HTML row without link; slugify also asserts `Đăng nhập thành công` -> `dang-nhap-thanh-cong`) |
| Verification command run | ☒ pass | `node --import tsx --test test/reports.test.ts test/session.test.ts && npx tsc --noEmit` at Fri Oct 30 07:20:22 AM UTC 2026 (after Supervisor pre-review fixes): `ℹ tests 54 / ℹ pass 54 / ℹ fail 0`, then `TSC_OK` (tsc exit 0, no output) |
| Negative cases hold | ☒ pass | corrupt `session-x.json`, `notes.json`, `screenshot-abc.png` not listed; `<script>` target escaped, slug `script-alert-1-script`; empty/symbol/CJK target -> `untitled`; a session JSON with no `.html` sibling is listed as "no HTML report" with no href (decided from the one `readdir` listing, no per-file stat); `Đ`/`đ` fold to `d`; `index.html` as a directory -> writeReports still resolves (error logged, tmp file removed) |
| verify | ☒ pass | **Supervisor 2026-10-30 07:21Z at 3178c23**, on a scratch **copy** of the real `reports/` (all 241 `session-*.json` + their `.html`; the real folder was not touched): `writeIndex` ran in **40 ms** and listed `241 session(s)` with 241 working report links, 0 `no HTML report` rows, and no `.tmp-*` leftovers. Status mix on real data: 131 passed / 112 failed / 1 other — pass. Re-ran the tests: reports + session + web → `ℹ tests 70 / ℹ pass 70 / ℹ fail 0`; `npx tsc --noEmit` clean. |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☒ pass | Reviewed `src/reports/index.ts` (`slugify`, `reportBaseName`, `atomicWrite`, `writeIndex`/`renderIndex`), `test/reports.test.ts`, and the two `writeReports` callers (`src/server.ts:177`, `src/api/run-test.ts:102`), which use only the returned paths — contract unchanged. `renderHtml`/`describe()` untouched. |
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

**WITNESS**: Supervisor, 2026-10-30 07:21Z — independent run of the final `writeIndex` against a copy of the 241 real sessions (see verify row).


---

## Code Review (Stage 4, light tier — Supervisor, 2026-10-30)

Scope: `52ce70d..3178c23`, `src/reports/index.ts` + `test/reports.test.ts`; callers `src/server.ts:177`, `src/api/run-test.ts:102`. Personas: correctness, testing, maintainability, standards, plus performance (it loops over the whole reports directory). Security is not activated: Low risk, all session text is HTML-escaped and the link href is `encodeURIComponent`-ed.

Entry-point reachability: `writeReports` is called at `src/server.ts:177` and `src/api/run-test.ts:102`, so it is reachable.

Pre-review round (fixed in 3178c23): P2 `Đ`/`đ` was dropped from slugs (Vietnamese labels); P2 the index showed a dead link when an HTML sibling was missing.

### P0 — Must Fix
None.

### P1 — Should Fix
None.

### P2 — Recommended
None remaining.

### P3 — Optional (follow-ups, not blocking)
| File | Finding | Confidence | Action |
|---|---|---|---|
| `src/reports/index.ts` | At 375px the Status and Report columns sit off-screen inside the scroll container; the verdict is visible only as the row colour | 100 | Put Status (and the link) before Target, or stack the cells on narrow screens |
| `src/reports/index.ts` | `writeIndex` re-parses every session JSON on each report write (40 ms for 241 today; grows with the folder) | 75 | Fine for now; revisit past ~2,000 sessions |
