# TASK_GUIDE — T044: README in two parts: highlights first, detail below
**Date**: 2026-11-11
**Risk Level**: Low (README layout and one test assertion; no wording of facts changes; no `src/` change)
**Assigned agents**: Supervisor (docs text, same as T039)

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `README.md`, `test/site.test.ts`, `test/docs-tools.test.ts` and this guide.)

## Requirement
User, 2026-11-11, after T039: "it does not wrong, but please make it focusing first, and the detail in the below, for general it will be 2 sections, 1 is highlight and 1 is detail its work".

## Acceptance Criteria
- [x] `README.md` has two top-level parts: `## Highlights` (positioning, the six-point table, Quick Start) and `## How it works in detail` (everything else).
- [x] Highlights is short enough to read without scrolling far: no reference material in it.
- [x] Every existing section survives, moved under the detail part one heading level down. No sentence is dropped or reworded, except the table lead-in.
- [x] Headings inside code fences are not touched.
- [x] Every in-README anchor link still resolves (anchors depend on heading text, which does not change).
- [x] `test/site.test.ts` T039 test checks the new order: Highlights, then Quick Start, then How it works in detail.
- [x] Full `npm test` 0 failures.

## Approach
Move Quick Start into Highlights (it is short and the first thing a reader needs). Demote the rest by one level with a fence-aware script, then read the diff.

## Files to change (predicted)
| File | Change |
|------|--------|
| `README.md` | two-part layout |
| `test/site.test.ts` | update the T039 README order assertions |
| `PROJECT_KANBAN.md` | board row |

## Files must NOT touch
| File | Reason |
|------|--------|
| `src/**`, `site/index.html` | layout change to README only |

## Verification Command
```
node --import tsx --test test/site.test.ts test/docs-tools.test.ts && npm test
```

## Completion checklist
- [x] Implementation done
- [x] Tests pass
- [x] Anchors checked
- [x] KANBAN updated
- [x] TASK_GUIDE marked complete
