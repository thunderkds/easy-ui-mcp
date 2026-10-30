# TASK_GUIDE — T021: Findable reports (readable filenames + `reports/index.html`)
**Date**: 2026-10-30
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P1
**Assigned agent**: backend-developer
**Agent guide**: `.claude/agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in your role guide
6. Read `BRAINSTORMING_LOG_agent-ergonomics.md` § "T021" and `BRAINSTORMING_LOG_reports.md` § "Adjacent Enhancements" items 5 and 7

---

## Requirement (Pillar 1 — Adapt the requirement)

User (2026-10-30): "testing result readable". Investigation finding #4: `reports/` holds 470 `session-<uuid>.{json,html}` files with no index; a human cannot tell which report is which run without opening each one.

**Restated intent**:
> A human can open one file, `reports/index.html`, and find any session by time, label and verdict; new report files have names that say when and what they were.

**Out of scope**:
- Deleting, moving or renaming any existing file in `reports/` (deferred to the user — destructive)
- Changing the content/layout of the per-session HTML report (T014)
- Changing where screenshots are written

**Requirement Refs**:
- FR-005: JSON + self-contained HTML report for every session
- FR-008: reports persisted to the host-mounted `reports/` folder
- US-005: review what happened and share evidence

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request (Supervisor, 2026-10-30 — provisional per user's "auto, defer confirmations" instruction)
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to a line in the Requirement
- [x] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

---

## Dependencies & Reachability

**Depends on**: None

**Entry point**: `writeReports`

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | New reports are named `session-<YYYYMMDD-HHMMSS>-<slug>-<id8>.{json,html}` where the timestamp is the session start (UTC), `slug` is derived from `target` (lower-case, runs of non-`[a-z0-9]` → `-`, trimmed, ≤40 chars, `untitled` if empty) and `id8` is the first 8 chars of the session id | names say when and what |
| 2 | The JSON body still contains the full session `id`; `writeReports` return value (`jsonPath`, `htmlPath`) points at the new names, so `server.ts` and `api/run-test.ts` keep working unchanged | no regression |
| 3 | After every `writeReports`, `reports/index.html` is (re)written: newest first, one row per session JSON in the directory (old `session-<uuid>.json` and new names both), columns: start time, target/label, status, action count, link to the HTML report | one file to find any session |
| 4 | `index.html` is self-contained (no external `<link>`, `<script src>`, `@import`) and HTML-escapes all session-derived text | reports self-contained (FR-005 constraint) |
| 5 | Unreadable/corrupt JSON files and non-session files are skipped, never crash; an index-write failure never fails `writeReports` (logged, report paths still returned) | boundary |
| 6 | Index lists at most the newest 500 sessions and says so when truncated | boundary (470+ files today) |

---

## Evaluation & Acceptance

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Temp dir with one legacy `session-<uuid>.json`, one corrupt `session-x.json`, and a new session written via `writeReports` with target `"Login flow / happy path"` | new files `session-<ts>-login-flow-happy-path-<id8>.*` exist; `index.html` lists 2 sessions newest first and links both HTML files | automated test `test/reports.test.ts` |
| 2 | Target `"<script>alert(1)</script>"` | slug is `script-alert-1-script`; index shows the target escaped | automated test |
| 3 | Target `""` / only symbols | slug `untitled` | automated test |
| 4 | Index write forced to fail (e.g. `index.html` path is a directory) | `writeReports` still resolves with report paths | automated test |

### Verification Command (exact, runnable)

```bash
node --import tsx --test test/reports.test.ts test/session.test.ts && npx tsc --noEmit
```

### Evidence

> Filled by the reviewer in `tasks/TASK_REVIEW_T021.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T021.md`.

---

## UI / Design Acceptance Criteria

`reports/index.html` is a human-facing page.

### 1. Visual Regression

| Screen / Component | Verification method | Expected result |
|-------------------|---------------------|-----------------|
| `reports/index.html` | Playwright screenshot of a generated index, reviewed by LLM vision | Readable table, status visually distinguishable (passed/failed) |

### 2. Design-System Compliance

| Criterion | Verification method | Expected result |
|-----------|---------------------|-----------------|
| Matches per-session report styling | Visual comparison with a T014 report | Same fonts/colours family as `src/reports/index.ts` inline CSS; no new design system |

### 3. Layout / Responsiveness

| Viewport | Verification method | Expected result |
|----------|---------------------|-----------------|
| Mobile (375px) | Playwright screenshot | No horizontal page scroll; table scrolls inside its container if needed |
| Desktop (1280px) | Playwright screenshot | Full table visible |

---

## Approach

**Pattern reference**: `src/reports/index.ts` — reuse `escapeHtml`, `atomicWrite`, and the existing inline-CSS style of `renderHtml`.

**Vital slice**: the filename change in `writeReports` + a `writeIndex(reportsDir)` called at its end.
**Cut list**:
- Renaming/deleting existing reports or the 803 loose screenshots (needs user confirmation)
- Filtering/search UI in the index (plain table only)
- A sidecar sessions log

Brainstorm Option A. Keep `writeIndex` a plain exported function (testable). Read only the fields needed from each JSON (`id`, `target`, `status`, `startedAt`, `actions.length`); derive the HTML link by swapping `.json` → `.html`. Wrap the index step in try/catch so it can never fail the session report.

---

## Edge Case Checklist

- [ ] Two sessions started in the same second with the same target → `id8` keeps names unique
- [ ] Non-ASCII target (e.g. Vietnamese diacritics) → slug drops to ASCII-safe characters, never empty-with-dashes
- [ ] JSON files are large (≤ ~110 KB today) → parse cost acceptable at 500; don't load screenshots
- [ ] `index.html` itself and `screenshot-*.png` are never treated as sessions
- [ ] Concurrent `writeReports` → `atomicWrite` prevents a torn index

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `src/reports/index.ts` | filename builder, `writeIndex`, call from `writeReports` |
| `test/reports.test.ts` | tests for AC1–AC6 |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts`, `src/server.ts` | T017–T019 are working there |
| `renderHtml` body / `describe()` | T014 output; T019 will add phrases to `describe()` |
| Any existing file in `reports/` | user's data — deletion/rename deferred to user |

---

## Test Plan

Test-first against a temp directory (`fs.mkdtemp`) — never the real `reports/`. Then run the verification command. For the UI rows, generate an index in a temp dir and take 375px and 1280px Playwright screenshots; save them under `reports/evidence/T021/`.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T021.md`
- [ ] UI evidence screenshots saved under `reports/evidence/T021/`
- [ ] `npx tsc --noEmit` clean
- [ ] Supervisor notified: task ready for Stage 4 review
