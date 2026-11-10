# Security finding rules

Rules for the `security-reviewer` persona of `code-review` and for the findings of `security-review`.

## Boundary and result
- Name the lower-trust actor, the boundary it crosses, the resource it reaches and the concrete result.
- Without all four, write a note, not a finding.

## Three outcomes
- Give each lead one verdict: `confirmed`, `needs_validation` or `rejected`.
- Give a severity to `confirmed` only.
- For `needs_validation`, name the one missing fact and one safe check that would settle it.
- A lead that cannot name its one missing fact is dropped, not parked as `needs_validation`.
- A `needs_validation` lead never blocks a merge by itself; the Supervisor decides.
- `rejected` means the code or a visible control disproves the lead. Record why, so it is not raised again.

## Severity from impact
- Critical: an outsider takes over a system, an account or a secret, with no step by the victim.
- High: a user reads or changes data that belongs to someone else, or runs code they should not.
- Medium: real harm that needs a rare state, a prior foothold or a victim step.
- Low: small leak or small harm with a narrow reach.
- Never rate above the damage you showed.
- A weakness that another layer already blocks is a hardening note, not a vulnerability.

## A different checker
- The agent that found a lead never confirms it.
- A second agent re-reads the code path from the claim alone and tries to disprove it.

## The fix
- Change the smallest part, at the last place that decides to trust the input.
- Add a regression test that fails before the fix.

## Do not guess
- A deployment, provider or identity fact that is not in the repo is a `needs_validation` blocker. Never assume it.
- Run target code only in a sandbox. If none exists, the verdict is `needs_validation`.

## Agents and prompts
- Prompt injection alone is not a finding. Show the tool call or the data it reaches.
- Treat model output, tool output, fetched pages and memory as untrusted input.
- A guardrail prompt is not a boundary. Look for a check in code.
- Check every tool-argument sink: an argument that reaches a shell, a path, a URL or a query.
- Check confused-deputy authority: an agent acts with more rights than the party that asked.

## Hooks, installer and supply chain
- Scope: `.claude/hooks/`, `setup.sh`, the plugin, CI, dependency install and release steps.
- Check what a hook or script runs on input it did not write: paths, branch names, file text.
- Check what the installer fetches, from where, and whether it pins and verifies it.
- Check CI secrets, token scope, and any step that runs code from a pull request.

Source: `cloudflare/security-audit-skill` (MIT). The text is adapted, not copied.
