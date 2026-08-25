import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const mappingPath = join(root, 'docs', 'MULTI_AGENT.md');
const adapterPath = join(root, 'AGENTS.md');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Codex adapter points to a complete, current Claude kit mapping', () => {
  assert.equal(existsSync(mappingPath), true, 'docs/MULTI_AGENT.md must exist');

  const mapping = readFileSync(mappingPath, 'utf8');
  const adapter = readFileSync(adapterPath, 'utf8');

  for (const requiredTerm of [
    'AGENTS.md',
    '.agents/skills',
    'hooks.json',
    'Subagents',
    'TASK_GUIDE',
    'Evidence Gate',
    'git worktree',
    'codex exec',
  ]) {
    assert.match(mapping, new RegExp(escapeRegExp(requiredTerm), 'i'));
  }

  for (const officialReference of [
    'https://developers.openai.com/codex/guides/agents-md',
    'https://developers.openai.com/codex/skills',
    'https://developers.openai.com/codex/multi-agent',
    'https://developers.openai.com/codex/hooks',
  ]) {
    assert.match(mapping, new RegExp(escapeRegExp(officialReference)));
  }

  // Guard the policy boundary, not just the presence of capability keywords. A
  // mapping that gives the implementer ownership of its own acceptance gate is
  // a regression even when every capability name and documentation URL remains.
  assert.match(mapping, /Claude Code remains the owner of[\s\S]*planning and Evidence Gates/);
  assert.match(mapping, /Claude supervisor owns the final Evidence Gate/);
  assert.match(mapping, /Claude Code remains responsible for:[\s\S]*filling `tasks\/TASK_REVIEW_Txxx\.md`/);
  assert.match(mapping, /Codex can implement the slice, while an independent supervisor[\s\S]*satisfies the task/);

  // Keep the dispatch recipe tied to the portable task contract.
  assert.match(mapping, /codex exec "Read PROJECT_SPEC\.md, memory\/MEMORY\.md, tasks\/TASK_GUIDE_T015\.md/);
  assert.match(mapping, /do not update the review evidence or KANBAN/);

  assert.match(adapter, /docs\/MULTI_AGENT\.md/);
  assert.match(adapter, /Claude supervisor still owns the canonical review,[\s\S]*verification, KANBAN, and memory gates/);
  assert.doesNotMatch(adapter, /Codex has no equivalent of Claude Code's hooks, skills, or `Skill`\/`Agent` tooling/);
});
