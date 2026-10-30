# TASK_REVIEW — T025: Static docs site for Vercel in Graphite Mint

> Sibling of `tasks/TASK_GUIDE_T025.md`. Everything here is **filled by the reviewer at Stage
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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ pass | `test/site.test.ts` (10 tests: AC1/2/3/4/5/6/7/9a-f/10 plus facts). Red commit 1431ef5: `ℹ tests 10 / pass 0 / fail 10`. Green commit fa14a01: see next row |
| Verification command run | ☑ pass | `node --import tsx --test test/site.test.ts test/docs-tools.test.ts && npx tsc --noEmit` -> `ℹ tests 11 / ℹ pass 11 / ℹ fail 0`, tsc exit 0 |
| Negative cases hold | ☑ pass | Static serve of `site/` (python3 http.server): `GET / -> 200`, `GET /requirements.txt -> 404`, `GET /reports/ -> 404`; `vercel.json` parses to `{framework:null,installCommand:"",buildCommand:"",outputDirectory:"site"}`, no rewrites |
| verify | ☑ pass | **Supervisor 2026-10-30**, user container stopped, branch at 98a790e: full `npm test` → `ℹ tests 141 / ℹ pass 141 / ℹ fail 0` — pass. Independent visual review of `docs-1280.png`, `docs-375.png`, `docs-1280-tools.png`: graphite bg, Easy Kit docs shell (top bar, `//` mono nav groups, content column), neon only on glyph/eyebrow/key number/step numbers/`$` prompts, outlined strip, code blocks and table — on-brand. Facts spot-checked against README/package.json (16 tools, port 8765, Chromium v1 scope, v0.1.0) |
| Review scope bounded to the change's blast radius (affected set, not whole repo) | ☑ pass | Stage 4 (Supervisor, light tier): reviewed `vercel.json`, `site/index.html` (no `<script>`, no external CSS; only outbound links are GitHub), `test/site.test.ts`, README line, the `git mv`. 0 P0–P2. P3: (1) pre-existing README link to a missing `AGENTS.md#using-easy-ui-mcp-from-another-repo` anchor; (2) Graphite Mint token fixture duplicated in `test/reports.test.ts` and `test/site.test.ts` |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` 141/141, exit 0 (see verify row) |
| **UI: Visual regression (diff or verdict pasted)** | ☑ pass | New page (no prior). LLM-vision verdict on the screenshots: dark graphite page, 64px top bar (`>_` glyph, name, GitHub link), left side nav with `// getting started` / `// reference` / `// operating` mono labels at 768 and 1280, outlined sunken code boxes with neon `$` prompts, outlined tables, neon only on glyph, eyebrow, key number `16`, step numbers 01-03 and prompts. Screenshots: see paths below |
| **UI: Design-system compliance (tokens/colors/typography verified)** | ☑ pass | Automated: `test/site.test.ts` AC9b (no hex/rgb outside `:root`, no inline `style=`), AC9c (every `:root` token equals the tokens.json fixture, every `var(--x)` declared), AC6 (weights 400/500/600, no uppercase, no gradients/box-shadow, text-shadow only `var(--glow-text)`, 2px neon focus ring). Computed style in Playwright: h1 `28px 600 "IBM Plex Sans", system-ui…`; body Plex Sans stack; `pre code` Plex Mono stack; code block radius 6px (`radius-sm`, as the design system assigns code boxes), table wrappers 8px (`radius-md`) |
| **UI: Responsiveness at target viewports** | ☑ pass | Playwright `scrollWidth` vs `clientWidth`: 375 -> 375/375, 768 -> 768/768, 1280 -> 1280/1280 (no page-level horizontal scroll). 375: nav is a static top list, main gutter 16px, code blocks (9) and tables (3) scroll inside their own boxes. 768: side nav + 520px main, stat strip 2x2. 1280: side nav + 920px column (`content-max`), strip 4-up, tables fit |

---

## Demonstration

> Anchors what this task delivered to an observable before/after pair. BEFORE has no `N/A` path:
> if the task changes executable code, BEFORE is a pasted, timestamped terminal capture taken
> **before any implementation commit exists**; if it does not (docs, templates, skill-instruction
> text), BEFORE is the **verbatim prior content** of what changed — a quoted excerpt, not a command.

**BEFORE** (captured before the first implementation commit):
```
$ date -u; ls site vercel.json requirements.txt 2>&1; head -3 requirements.txt
Fri Oct 30 10:35:17 AM UTC 2026
ls: cannot access 'site': No such file or directory
ls: cannot access 'vercel.json': No such file or directory
requirements.txt
Refined Goal
Create a unified UI Testing MCP Server that: 
```

**AFTER** (same command, after commit fa14a01):
```
$ date -u; ls site vercel.json requirements.txt 2>&1; head -3 docs/original-plan.md
Fri Oct 30 10:40:53 AM UTC 2026
ls: cannot access 'requirements.txt': No such file or directory
vercel.json

site:
index.html
Refined Goal
Create a unified UI Testing MCP Server that:
```
Screenshots (git-ignored, in the worktree): `reports/evidence/T025/docs-375.png`, `docs-768.png`, `docs-1280.png` (first viewport), `docs-375-full.png`, `docs-768-full.png`, `docs-1280-full.png` (full page), `docs-375-networking.png`, `docs-375-troubleshooting.png`, `docs-1280-tools.png`. Absolute prefix: `/home/hungnguyenhuu/workspace/pets/hungnguyen111/easy-ui-mcp/.claude/worktrees/agent-af3b6febb28c46931/reports/evidence/T025/`

**DELTA**: Pushing `main` to Vercel now publishes a static docs page (what it is, how to run it, tools, reports, REST, troubleshooting) instead of failing on `requirements.txt` being parsed as a pip file.

**WITNESS**: [who ran it and when — derived from `memory/event-trace/T025.jsonl`, never the
implementing agent alone]
