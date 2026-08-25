# Claude Code Kit → Codex Mapping

> **Status:** Reference for this repository's Claude-first supervisor kit. Verified against the
> installed kit and official OpenAI documentation on 2026-08-25. Claude Code remains the owner of
> this project's planning and Evidence Gates; Codex may act as an implementer or reviewer only when
> the task assignment says so.

## The portable contract

The portability boundary is the plain-Markdown task contract:

- `PROJECT_SPEC.md` describes architecture and constraints.
- `tasks/TASK_GUIDE_Txxx.md` defines scope, acceptance criteria, predicted files, and one runnable
  verification command.
- `tasks/TASK_REVIEW_Txxx.md` records independent Stage 4/5 evidence.
- `PROJECT_KANBAN.md` records task state.

The implementer can change without changing that contract. The implementing agent runs the guide's
verification command, but the Claude supervisor owns the final Evidence Gate so the implementer is
not the sole judge of its own work.

```text
Claude supervisor                         Codex implementer
  Stage 2: TASK_GUIDE + oracle  ────────▶  read contract + implement in worktree
  Stage 3: isolated git worktree           run the verification command
  Stage 4/5: review + Evidence Gate ◀────  return diff and raw test output
```

## Capability mapping

“Equivalent” below means the current Codex platform has a matching mechanism. It does **not** mean
files under `.claude/` are automatically discovered or semantically identical in Codex.

| Claude Code kit surface | Current Codex mapping | Portability in this repository |
|---|---|---|
| `CLAUDE.md` project instructions | Root/nested `AGENTS.md` or `AGENTS.override.md` | Direct concept; this root `AGENTS.md` is the thin adapter. Codex does not auto-read `CLAUDE.md`. |
| `.claude/agents/*.md` role definitions and `Agent(...)` | Built-in Subagents plus project custom agents in `.codex/agents/*.toml` | Equivalent mechanism, different schema. No automatic conversion is installed here. |
| `.claude/skills/<name>/SKILL.md` and `Skill(...)` | Skills in `.agents/skills/<name>/SKILL.md`, invoked explicitly with `$name` or selected implicitly | Skill format is portable, but the discovery path and invocation syntax differ. This repo has not mirrored the Claude skill tree. |
| `.claude/hooks/` and `.claude/settings*.json` lifecycle hooks | `.codex/hooks.json` or inline hooks in `.codex/config.toml` | Equivalent lifecycle mechanism, including `PreToolUse`, `PostToolUse`, and `Stop`; scripts/config must be adapted and trusted separately. |
| Claude subagent delegation | Codex Subagents and custom agents | Direct concept. Delegate bounded independent work; avoid parallel edits to the same files. |
| `code-review`, `security-review`, `verify`, `ship`, `migration-safety` | Codex skills or review workflows when installed | Conceptually portable, not guaranteed by matching names. For this project, the Claude supervisor still runs the canonical gates. |
| MCP tools | MCP servers configured for Codex | Direct protocol-level mapping; registration/configuration is client-specific. |
| `git worktree` isolation | The same `git worktree` commands | Direct and client-independent. |
| `memory/MEMORY.md` reading | Read the same Markdown file when the task guide requires it | Direct. Codex memory features do not replace this project's curated task context. |
| Supervisor-only memory writes | Return learnings to the Claude supervisor | Intentionally not delegated in this project. |
| `PROJECT_KANBAN.md` transitions and Evidence Gate | Return status/evidence to the Claude supervisor | Intentionally remains Claude-owned to preserve independent acceptance. |

Current Codex behavior is documented by OpenAI in
[AGENTS.md discovery](https://developers.openai.com/codex/guides/agents-md),
[skills](https://developers.openai.com/codex/skills),
[Subagents](https://developers.openai.com/codex/multi-agent), and
[hooks](https://developers.openai.com/codex/hooks).

## Codex dispatch recipe

The supervisor creates or selects the task worktree first. Run Codex from that exact directory:

```bash
cd <task-worktree-path>
codex exec "Read PROJECT_SPEC.md, memory/MEMORY.md, tasks/TASK_GUIDE_T015.md, and the role guide named by the task guide. Implement only the acceptance criteria, test-first, touching only predicted files. Run the task guide's verification command and return the changed-file list plus raw output. Stop and report any ambiguity; do not update the review evidence or KANBAN."
```

Replace `T015` with the assigned task ID. Keep one task per invocation. Check `codex exec --help`
before copying extra flags from older examples because CLI flags can change.

For an interactive Codex session, give the same task pointer in the prompt. Codex loads this root
`AGENTS.md` automatically, then the task guide supplies the task-specific contract.

## Optional deeper mapping

Only add these adapters when a task requires them; the Markdown contract above is sufficient for a
single Codex implementer.

### Skills

A Claude skill can be evaluated for reuse under `.agents/skills/<name>/SKILL.md`. Preserve its
instructions, scripts, references, and assets, but audit tool names and Claude-specific invocation
syntax. Do not symlink the whole `.claude/skills/` tree blindly: built-in dependencies and
project-specific paths may not exist in Codex.

### Custom agents

Codex project agents live in `.codex/agents/*.toml`, not `.claude/agents/*.md`. A custom agent needs
`name`, `description`, and `developer_instructions`; it can also set model, reasoning, sandbox, MCP,
and skill configuration. Create one only when repeated delegation justifies a maintained adapter.

### Hooks

Codex can run command or MCP hooks from `.codex/hooks.json` or `.codex/config.toml`. Treat a port as
new configuration: verify event payloads, tool-name matchers, blocking semantics, and trust state.
A Claude hook merely present under `.claude/hooks/` does not protect a Codex run.

## What remains Claude-owned here

Even though Codex now supports instructions, skills, hooks, subagents, MCP, worktrees, and review
workflows, capability parity is not policy ownership. Until a separate migration task changes the
project contract, Claude Code remains responsible for:

- creating and signing off the requirement oracle;
- running the canonical Stage 4/5 review and verification skills;
- filling `tasks/TASK_REVIEW_Txxx.md`;
- moving task state in `PROJECT_KANBAN.md`; and
- curating project memory.

This separation is deliberate: Codex can implement the slice, while an independent supervisor
decides whether the evidence satisfies the task.
