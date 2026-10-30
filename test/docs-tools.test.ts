import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

/** Tool names registered in src/server.ts: literal names plus `TOOL.<key>` constants. */
function registeredTools(): string[] {
  const server = read('src/server.ts');
  const constants = new Map<string, string>();
  const block = server.match(/const TOOL = \{([\s\S]*?)\} as const;/);
  for (const [, key, name] of (block?.[1] ?? '').matchAll(/(\w+):\s*"([^"]+)"/g)) {
    constants.set(key, name);
  }
  const names: string[] = [];
  for (const [, literal, key] of server.matchAll(/registerTool\(\s*(?:"([^"]+)"|TOOL\.(\w+))/g)) {
    const name = literal ?? constants.get(key);
    assert.ok(name, `cannot resolve a registerTool name (TOOL.${key})`);
    names.push(name);
  }
  return names;
}

test('README and RUNBOOK name every registered tool, and RUNBOOK states the count', () => {
  const tools = registeredTools();
  assert.ok(tools.length > 0, 'found no registerTool calls in src/server.ts');
  assert.equal(new Set(tools).size, tools.length, 'duplicate tool registration');

  for (const file of ['README.md', 'RUNBOOK.md']) {
    const doc = read(file);
    for (const tool of tools) {
      assert.ok(doc.includes(`\`${tool}\``), `${file} does not mention \`${tool}\``);
    }
  }

  assert.match(
    read('RUNBOOK.md'),
    new RegExp(`all ${tools.length} tools`),
    `RUNBOOK must say "all ${tools.length} tools"`,
  );
});
