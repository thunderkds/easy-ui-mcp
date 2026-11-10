# TASK_GUIDE — T037: The current-site dot in the family nav glows like the siblings
**Date**: 2026-11-10
**Risk Level**: Low (one CSS rule + one token in `site/index.html`, one test assertion)
**Assigned agents**: frontend-developer

> Read relevant files from `docs/legacy/` before making any code changes. (This project has no `docs/legacy/`; read `site/index.html`, `test/site.test.ts` and this guide.)

## Requirement
User, 2026-11-10: "the span dot beside the easy ui navigation is not light like others".

The family sites light the current site's dot with a glow: easy-personal sets `--glow-dot: 0 0 8px #3cf5a8;` (dark theme) and `.family-nav a[aria-current="page"] .dot { background: var(--color-accent); box-shadow: var(--glow-dot); }`; easy-memory does the same through `.fam[aria-current="page"]::before { background: var(--neon); box-shadow: var(--glow-dot); }`. Ours (`site/index.html`) only sets `background: var(--neon)` on `.family-nav a[aria-current="page"] .dot` — no glow — because `test/site.test.ts` (T025 AC6) forbids any `box-shadow`.

## Acceptance Criteria
- [ ] `:root` defines `--glow-dot: 0 0 8px #3cf5a8;` (raw hex stays inside `:root`, as the tests require). If the page has a light theme block, set `--glow-dot: none;` there, as the siblings do.
- [ ] `.family-nav a[aria-current="page"] .dot` (header and phone sidebar) gets `box-shadow: var(--glow-dot);`. No other element gets a box-shadow.
- [ ] `test/site.test.ts` T025 AC6: instead of banning every `box-shadow`, allow exactly `box-shadow: var(--glow-dot)` and nothing else (keep the text-shadow and gradient rules); add an assertion that the current-site dot rule uses it. Red before the CSS change, green after.
- [ ] Full `npm test` 0 failures.
- [ ] Screenshot of the header at 1280px (and the phone sidebar at 375px with the Menu open) shows the Easy UI dot glowing like easy-memory's Easy Memory dot.

## Files to change (predicted)
| File | Change |
|------|--------|
| `site/index.html` | `--glow-dot` token, `box-shadow` on the current dot |
| `test/site.test.ts` | allow only `var(--glow-dot)` box-shadow; assert the dot uses it |

## Files must NOT touch
| File | Reason |
|------|--------|
| everything else | one-rule change |

## Verification Command
```
node --import tsx --test test/site.test.ts && npm test
```

## Completion checklist
- [ ] Implementation done
- [ ] Tests pass
- [ ] Screenshot checked
- [ ] TASK_GUIDE marked complete
