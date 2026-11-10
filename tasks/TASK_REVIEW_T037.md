# TASK_REVIEW — T037: The current-site dot in the family nav glows like the siblings

## Evidence

| Check | Result | Notes |
|---|---|---|
| Tests | ☑ pass | Supervisor full `npm test` on e9bac17: tests 307, pass 307, fail 0 (traced under T037); site.test.ts red (17/1) → green (18/18) |
| verify | ☑ pass | pass — Supervisor viewed `t037-1280.png`: the Easy UI dot glows mint (`box-shadow: var(--glow-dot)`, `--glow-dot: 0 0 8px #3cf5a8` as on easy-personal/easy-memory), the other four dots stay flat grey; the phone sidebar uses the same `.family-nav` rule (`t037-375.png`). |
| UI: Design-system compliance | ☑ pass | the only box-shadow on the page is `var(--glow-dot)`, enforced by test |

**WITNESS**: Supervisor, 2026-11-10, full `npm test` 307/307 on e9bac17 traced under T037; header screenshot reviewed.
