// T025 — static docs site (site/index.html) deployed by Vercel via vercel.json.
// Everything here reads repo files only: no browser, no server, no network.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const page = () => read('site/index.html');

/** Tool names registered in src/server.ts (same extraction as test/docs-tools.test.ts). */
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

/** Graphite Mint values (tokens.json) for every token the page may declare. Copied here so the
 * test never reads outside the repo; a drifting value in the page fails AC9(c). */
const GRAPHITE_MINT_TOKENS: Record<string, string> = {
  bg: '#121413',
  'bg-sunken': '#0E100F',
  'bg-raised': '#181B1A',
  'line-subtle': '#1F2321',
  line: '#262B29',
  'line-strong': '#2C3230',
  'line-header': '#232826',
  'text-strong': '#EAEDEA',
  text: '#DCE0DD',
  'text-2': '#ABB3AE',
  'text-nav': '#B5BCB7',
  'text-muted': '#8C9590',
  'text-dim': '#6E7772',
  accent: '#7EDDB0',
  'accent-hover': '#B2EDCF',
  neon: '#3CF5A8',
  'neon-soft': 'rgba(60, 245, 168, 0.08)',
  'neon-line': 'rgba(60, 245, 168, 0.35)',
  'on-neon': '#0E100F',
  warn: '#E3B66B',
  'glow-text': '0 0 12px rgba(60, 245, 168, 0.35)',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-7': '32px',
  'space-8': '40px',
  'space-9': '48px',
  'space-10': '56px',
  'radius-xs': '4px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'header-h': '64px',
  'sidebar-w': '248px',
  'content-max': '920px',
  'font-sans': '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-mono': '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
};

/** The AC4 sections, in page order. */
const SECTION_IDS = [
  'overview',
  'quick-start',
  'another-repo',
  'networking',
  'tools',
  'writing-a-flow',
  'reports',
  'rest-wrapper',
  'troubleshooting',
  'development',
];

function styleOf(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, 'page has one inline <style>');
  return m[1];
}

/** The `:root { ... }` block and the CSS with that block removed. */
function splitRoot(css: string): { root: string; rest: string } {
  const m = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(m, 'page CSS declares tokens on :root');
  return { root: m[1], rest: css.replace(m[0], '') };
}

test('T025 AC9a: every registered tool appears on the page, and the page states the count', () => {
  const tools = registeredTools();
  assert.ok(tools.length > 0, 'found no registerTool calls in src/server.ts');
  const html = page();
  for (const tool of tools) assert.ok(html.includes(tool), `site/index.html does not mention ${tool}`);
  assert.ok(html.includes(`${tools.length} tools`), `page must say "${tools.length} tools"`);
});

test('T025 AC9b: no raw colour value outside the :root token block, and no inline style attributes', () => {
  const html = page();
  const { rest } = splitRoot(styleOf(html));
  assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour in component rules');
  assert.doesNotMatch(rest, /\b(rgba?|hsla?)\(/i, 'no rgb()/hsl() in component rules');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'no inline style attributes');
});

test('T025 AC9c: every :root token has exactly the Graphite Mint value, and every var(--x) is declared', () => {
  const { root: rootBlock, rest } = splitRoot(styleOf(page()));
  const declared = new Map<string, string>();
  for (const m of rootBlock.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) declared.set(m[1], m[2].trim());
  assert.ok(declared.size > 0);
  for (const [name, value] of declared) {
    assert.ok(name in GRAPHITE_MINT_TOKENS, `--${name} is a known Graphite Mint token`);
    assert.equal(value.toLowerCase(), GRAPHITE_MINT_TOKENS[name].toLowerCase(), `--${name} value`);
  }
  for (const m of rest.matchAll(/var\(--([a-z0-9-]+)/g)) {
    assert.ok(declared.has(m[1]), `var(--${m[1]}) is declared on :root`);
  }
});

test('T025 AC6: weights 400/500/600 only, no all-caps, no gradients or drop shadows, neon focus ring', () => {
  const css = styleOf(page());
  for (const m of css.matchAll(/font(?:-weight)?\s*:\s*(\d{3})\b/g)) {
    assert.ok(['400', '500', '600'].includes(m[1]), `weight ${m[1]}`);
  }
  assert.doesNotMatch(css, /text-transform|uppercase|small-caps/i);
  assert.doesNotMatch(css, /gradient\(/i);
  assert.doesNotMatch(css, /box-shadow/i, 'no box-shadow (glow-box is not used on this page)');
  for (const m of css.matchAll(/text-shadow\s*:\s*([^;]+);/g)) {
    assert.equal(m[1].trim(), 'var(--glow-text)', 'text-shadow is only the neon glow token');
  }
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--neon\)[^}]*outline-offset:\s*2px/);
});

test('T025 AC3/AC9d: the page is self-contained (no external script, stylesheet, import or url())', () => {
  const html = page();
  assert.doesNotMatch(html, /<script[^>]*\ssrc\s*=/i, 'no <script src');
  assert.doesNotMatch(html, /<link[^>]*rel\s*=\s*["']?stylesheet/i, 'no <link rel="stylesheet"');
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(styleOf(html), /url\(/i);
});

test('T025 AC1/AC2/AC9e: vercel.json serves site/ with no install or build; requirements.txt is gone', () => {
  assert.deepEqual(JSON.parse(read('vercel.json')), {
    framework: null,
    installCommand: '',
    buildCommand: '',
    outputDirectory: 'site',
  });
  assert.ok(!existsSync(join(root, 'requirements.txt')), 'no requirements.txt at the root');
  assert.ok(existsSync(join(root, 'docs/original-plan.md')), 'the planning prose lives at docs/original-plan.md');
  assert.match(read('docs/original-plan.md'), /^Refined Goal/);
});

test('T025 AC4/AC9f: every section id exists in order, and every in-page href points at an existing id', () => {
  const html = page();
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  let last = -1;
  for (const id of SECTION_IDS) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > -1, `section #${id} exists`);
    assert.ok(at > last, `section #${id} is in the AC4 order`);
    last = at;
  }
  const hrefs = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= SECTION_IDS.length, 'nav links to every section');
  for (const target of hrefs) assert.ok(ids.includes(target), `href="#${target}" points at an existing id`);
  for (const id of SECTION_IDS) assert.ok(hrefs.includes(id), `a link targets #${id}`);
});

test('T025 AC5/AC7: shell and accessibility landmarks', () => {
  const html = page();
  assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, 'exactly one h1');
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<a class="[^"]*skip[^"]*" href="#main"/, 'skip link to #main');
  assert.match(html, /<main[^>]*id="main"/);
  assert.match(html, /<nav[^>]*aria-label=/, 'labelled nav landmark');
  assert.ok(html.includes('https://github.com/thunderkds/easy-ui-mcp'), 'GitHub link');
  assert.match(html, />\/\/ getting started</, 'lowercase mono nav group label');
  assert.match(html, />\/\/ reference</);
  for (const m of html.matchAll(/<button\b[^>]*>/g)) {
    assert.match(m[0], /aria-label=|aria-controls=/, `button has an accessible name: ${m[0]}`);
  }
});

test('T025 facts: key commands and numbers match README/RUNBOOK', () => {
  const html = page();
  for (const needle of [
    'docker compose up -d --build',
    'curl http://localhost:8765/health',
    'claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp',
    'network_mode: host',
    'host.docker.internal',
    'POST /api/run-test',
    'reports/index.html',
    'session-&lt;YYYYMMDD-HHMMSS&gt;-&lt;slug&gt;-&lt;id8&gt;',
    'npm ci',
    'npm test',
  ]) {
    assert.ok(html.includes(needle), `page includes ${needle}`);
  }
});

test('T025 AC10: README links to the docs site source', () => {
  assert.match(read('README.md'), /site\/index\.html/);
});
