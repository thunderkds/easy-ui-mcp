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
  for (const [, literal, key] of server.matchAll(/register(?:Session)?Tool\(\s*(?:"([^"]+)"|TOOL\.(\w+))/g)) {
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
  'glow-dot': '0 0 8px #3cf5a8',
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

/** The sections, in page order (T036 regrouped them as overview / guide / reference). */
const SECTION_IDS = [
  'overview',
  'why-easy-ui',
  'how-it-works',
  'a-session',
  'before-after',
  'quick-start',
  'another-repo',
  'networking',
  'writing-a-flow',
  'several-sessions',
  'tools',
  'seeing-the-page',
  'overlays-and-dialogs',
  'real-sizes-and-typing',
  'debugging-and-tabs',
  'reports',
  'rest-wrapper',
  'measured',
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
  for (const m of css.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
    assert.equal(m[1].trim(), 'var(--glow-dot)', 'box-shadow is only the current-site dot glow token');
  }
  assert.match(
    css,
    /\.family-nav a\[aria-current="page"\] \.dot\s*\{[^}]*box-shadow:\s*var\(--glow-dot\)/,
    'the current-site dot glows like the sibling sites',
  );
  for (const m of css.matchAll(/text-shadow\s*:\s*([^;]+);/g)) {
    assert.equal(m[1].trim(), 'var(--glow-text)', 'text-shadow is only the neon glow token');
  }
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--neon\)[^}]*outline-offset:\s*2px/);
});

test('T025 AC3/AC9d + T036: no external script, import or url(); the only stylesheet is the IBM Plex fonts', () => {
  const html = page();
  assert.doesNotMatch(html, /<script[^>]*\ssrc\s*=/i, 'no <script src');
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(styleOf(html), /url\(/i);
  const sheets = [...html.matchAll(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi)].map((m) => m[0]);
  assert.equal(sheets.length, 1, 'exactly one external stylesheet');
  assert.match(sheets[0], /href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*family=IBM\+Plex\+Sans:wght@400;500;600;700[^"]*"/);
  assert.match(sheets[0], /family=IBM\+Plex\+Mono:wght@400;500/);
  assert.match(html, /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/);
  assert.match(html, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
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

test('T035: the four guide sections are in the sidebar and carry their facts', () => {
  const html = page();
  const nav = html.slice(html.indexOf('id="sidenav"'), html.indexOf('<main'));
  const section = (id: string) => {
    const start = html.indexOf(`<section id="${id}"`);
    assert.ok(start > -1, `section #${id} exists`);
    return html.slice(start, html.indexOf('</section>', start));
  };
  const facts: Record<string, string[]> = {
    'seeing-the-page': ['ui_get_page_state', 'ui_get_text', 'overlays', 'focused', '4000'],
    'overlays-and-dialogs': ['ui_click_outside', 'ui_dialog', 'clickCount', 'DIALOG_TIMEOUT_MS', '120000'],
    'real-sizes-and-typing': ['iPhone 13', 'ui_set_viewport', 'ui_type', 'ui_navigate_history', '1280x8000', 'fullPage'],
    'debugging-and-tabs': ['ui_get_logs', 'ui_tabs', 'ui_upload_file', 'default_draft.png', 'ui_drag', 'reports/downloads/', '25 MB', '20'],
  };
  for (const [id, needles] of Object.entries(facts)) {
    assert.ok(nav.includes(`href="#${id}"`), `sidebar links to #${id}`);
    const body = section(id);
    for (const needle of needles) assert.ok(body.includes(needle), `#${id} mentions ${needle}`);
    assert.match(body, /<pre><code>/, `#${id} has an example call`);
  }
});

test('T039: the page and README lead with UI testing and evidence, and the Why section carries the six points', () => {
  const html = page();
  const nav = html.slice(html.indexOf('id="sidenav"'), html.indexOf('<main'));
  assert.ok(nav.includes('href="#why-easy-ui"'), 'sidebar links to #why-easy-ui');
  assert.match(html, /<meta name="description" content="[^"]*UI-testing MCP[^"]*report/, 'meta description states the testing focus');

  const hero = html.slice(html.indexOf('<section id="overview"'), html.indexOf('</section>', html.indexOf('<section id="overview"')));
  assert.match(hero, /Not just another browser controller/, 'hero lede draws the line from general browser control');
  assert.match(hero, /structured report/, 'hero lede promises a structured report');

  const start = html.indexOf('<section id="why-easy-ui"');
  const why = html.slice(start, html.indexOf('</section>', start));
  for (const needle of [
    'Structured reports',
    'Testing primitives',
    'ui_assert',
    'ui_check',
    'ui_wait_for',
    'A verdict you can trust',
    'Browser problems',
    'Local first',
    'docker compose up -d --build',
    'No LLM inside',
    'Made for Claude Code',
    'dist/stdio.js',
  ]) {
    assert.ok(why.includes(needle), `#why-easy-ui mentions ${needle}`);
  }

  const readme = read('README.md');
  assert.match(readme, /local UI-testing MCP that gives your agent structured, shareable test reports/, 'README carries the positioning line');
  // T046: the README is short (problem, why, quick start); the detail lives on the page.
  const lines = readme.replace(/\n$/, '').split('\n');
  assert.ok(lines.length <= 60, `README is at most 60 lines (now ${lines.length})`);
  const at = (h: string) => readme.indexOf(`\n${h}\n`);
  assert.ok(at('## The problem') > -1 && at('## Why use it') > -1 && at('## Quick Start') > -1, 'README has The problem, Why use it and Quick Start');
  assert.ok(at('## The problem') < at('## Why use it'), 'the problem comes first');
  assert.ok(at('## Why use it') < at('## Quick Start'), 'why comes before Quick Start');
  const whyTable = readme.slice(at('## Why use it'), at('## Quick Start'));
  const rows = whyTable.split('\n').filter((l) => /^\| \*\*/.test(l));
  assert.ok(rows.length >= 6, 'the why table keeps all six points');
  for (const row of rows) assert.ok(row.length <= 260, `one short row each: ${row.slice(0, 40)}`);
  for (const needle of ['report', 'ui_assert', 'verdict', 'one command', 'No LLM', 'Claude Code', 'Fewer wasted calls']) {
    assert.ok(whyTable.toLowerCase().includes(needle.toLowerCase()), `the why table mentions ${needle}`);
  }
  assert.ok(readme.includes('docker compose up -d --build') && readme.includes('curl http://localhost:8765/health') && readme.includes('claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp'), 'Quick Start has build, health check and claude mcp add');
  assert.ok(readme.includes('mcp-proxy -- node dist/stdio.js'), 'README has the short stdio note');
  const siteIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const guideLinks = [...readme.matchAll(/\]\((https:\/\/easy-ui-mcp\.vercel\.app\/)([^)]*)\)/g)];
  assert.ok(guideLinks.length >= 2, 'README links into the guide');
  for (const [, , rest] of guideLinks) {
    assert.ok(rest === '' || rest.startsWith('#'), `guide link ${rest} is the page or an anchor`);
    if (rest.startsWith('#')) assert.ok(siteIds.has(rest.slice(1)), `README link ${rest} has a matching id in site/index.html`);
  }
  assert.doesNotMatch(readme, /\]\(site\/index\.html#/, 'no relative anchor links to the site');
  for (const doc of ['AGENTS.md', 'HARNESS.md', 'RUNBOOK.md', 'PRD.md']) assert.ok(readme.includes(doc), `README links ${doc}`);
  assert.match(read('package.json'), /"description": "Local UI-testing MCP server/, 'package.json description matches');
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
  assert.match(html, />\/\/ overview</, 'lowercase mono nav group label');
  assert.match(html, />\/\/ reference</);
  for (const m of html.matchAll(/<button\b[^>]*>/g)) {
    assert.match(m[0], /aria-label=|aria-controls=/, `button has an accessible name: ${m[0]}`);
  }
});

test('T046: the page holds what the README no longer does: stdio, Scope (v1) and the other docs', () => {
  const html = page();
  const nav = html.slice(html.indexOf('id="sidenav"'), html.indexOf('<main'));
  const section = (id: string) => {
    const start = html.indexOf(`<section id="${id}"`);
    assert.ok(start > -1, `section #${id} exists`);
    return html.slice(start, html.indexOf('</section>', start));
  };
  for (const id of ['stdio', 'scope', 'more-docs']) assert.ok(nav.includes(`href="#${id}"`), `sidebar links to #${id}`);
  const stdio = section('stdio');
  for (const needle of ['mcp-proxy -- node dist/stdio.js', 'pnpm build', 'dist/stdio.js', 'one client', 'stdin']) {
    assert.ok(stdio.includes(needle), `#stdio mentions ${needle}`);
  }
  const scope = section('scope');
  for (const needle of ['Chromium', 'local only', 'Android', 'android_*']) assert.ok(scope.includes(needle), `#scope mentions ${needle}`);
  const docs = section('more-docs');
  for (const doc of ['AGENTS.md', 'HARNESS.md', 'RUNBOOK.md', 'PRD.md']) assert.match(docs, new RegExp(`<a href="[^"]*${doc.replace('.', '\\.')}">`), `#more-docs links ${doc}`);
});

test('T046: finer reference detail from the old README is on the page', () => {
  const html = page();
  for (const needle of [
    'Unknown session',
    'was closed after 10 min idle',
    '-webkit-text-security',
    'host-gateway"]',
    'nth=',
    'checked=false',
    'alertdialog',
    'menuitemradio',
    'Showing 37 of 180 elements',
    '{role, name, selector, state?}',
    'requestfailed',
    'Downloaded: &lt;name&gt;',
    '&lt;host-LAN-IP&gt;:8766',
  ]) {
    assert.ok(html.includes(needle), `site/index.html keeps ${needle}`);
  }
  assert.match(read('README.md'), /\[`site\/index\.html`\]\(site\/index\.html\)/, 'README links the site source file');
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

/** The Easy Kit family, in the order every sibling site lists it. */
const FAMILY = [
  ['Easy Kit', 'https://easy-kits.vercel.app/'],
  ['Easy Verifier', 'https://easy-verifier.vercel.app/'],
  ['Easy UI', 'https://easy-ui-mcp.vercel.app/'],
  ['Easy Memory', 'https://easy-memory.vercel.app/'],
  ['Easy Personal', 'https://easy-personal.vercel.app/'],
];

test('family nav: header and drawer list the five Easy Kit sites in order, Easy UI is the current page', () => {
  const html = page();
  const navs = [...html.matchAll(/<nav class="family-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/g)];
  assert.equal(navs.length, 2, 'one family nav in the header and one copy in the sidebar drawer');
  assert.ok(html.indexOf('<nav class="family-nav"') < html.indexOf('</header>'), 'first family nav sits in the header');
  for (const [, body] of navs) {
    const links = [...body.matchAll(/<a ([^>]*)><span class="dot" aria-hidden="true"><\/span>([^<]+)<\/a>/g)];
    assert.deepEqual(
      links.map((m) => [m[2], m[1].match(/href="([^"]+)"/)?.[1]]),
      FAMILY,
    );
    const current = links.filter((m) => /aria-current="page"/.test(m[1])).map((m) => m[2]);
    assert.deepEqual(current, ['Easy UI'], 'only Easy UI carries aria-current="page"');
  }
  assert.doesNotMatch(html, /easy-ui\.vercel\.app/, 'never link the unrelated easy-ui.vercel.app');
  assert.doesNotMatch(html, /personal-agentic-claude/, 'the old Easy Kit address is gone everywhere');
});

test('phones: a Menu button collapses the sidebar below 720px; without script the sidebar stays open', () => {
  const html = page();
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(
    header,
    /<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sidenav">Menu<\/button>/,
    'the header has a Menu button that controls #sidenav',
  );
  assert.match(html, /<nav class="sidenav" id="sidenav" aria-label="Documentation">/, 'the sidebar has id="sidenav"');
  // Collapsing applies only with script (.js) and only on phones, so no link is ever unreachable.
  const phone = html.match(/@media \(max-width: 719px\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.match(phone, /\.js \.nav-toggle \{[^}]*display: inline-flex/, 'Menu shows on phones when script runs');
  assert.match(phone, /\.js \.sidenav:not\(\.is-open\) \{ display: none; \}/, 'sidebar collapses on phones unless open');
  assert.match(html, /\.nav-toggle \{ display: none;/, 'Menu is hidden by default (desktop, no script)');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.match(script, /classList\.add\('js'\)/, 'inline script marks the page as scripted');
  assert.match(script, /aria-expanded/, 'the script keeps aria-expanded in step');
});

test('desktop: the header lines up with the centered page column instead of the window edges', () => {
  const html = page();
  const shell = html.match(/\.shell \{ max-width: ([^;]+);/)?.[1];
  assert.ok(shell, '.shell has a max-width');
  const wide = html.match(/@media \(min-width: 720px\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  const rule = wide.match(/\.topbar \{([^}]*)\}/)?.[1] ?? '';
  // Left: over the sidebar link text (shell edge + sidebar padding + item padding).
  assert.ok(
    rule.includes(`padding-left: max(calc(var(--space-7) + 12px), calc((100% - (${shell})) / 2 + var(--space-7) + 12px));`),
    `header left edge must follow the shell: ${rule}`,
  );
  // Right: over the content's right edge (shell edge + main padding).
  assert.ok(
    rule.includes(`padding-right: max(var(--space-7), calc((100% - (${shell})) / 2 + var(--space-7)));`),
    `header right edge must follow the shell: ${rule}`,
  );
});

test('T036: header follows the family pattern: icon tile, "Easy UI", mono chip, bordered GitHub button', () => {
  const html = page();
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /<svg class="glyph"[^>]*aria-hidden="true"/, 'rounded-square icon tile');
  assert.match(header, /<rect [^>]*rx="/, 'the icon is a rounded square');
  assert.match(header, /<span>Easy UI<\/span>/, 'Title-Case product name');
  assert.match(header, /<span class="chip">ui testing · mcp server<\/span>/, 'mono chip');
  assert.match(header, /<a class="btn" href="https:\/\/github\.com\/thunderkds\/easy-ui-mcp">GitHub<\/a>/, 'GitHub is a bordered button');
  assert.doesNotMatch(html, /<title>easy-ui-mcp docs/, 'title no longer says "docs"');
});

test('T036: hero has the mono tagline, big title, primary + secondary button and three tiles', () => {
  const html = page();
  const start = html.indexOf('<section id="overview"');
  const hero = html.slice(start, html.indexOf('</section>', start));
  assert.match(hero, /<p class="eyebrow">&gt; /, 'green mono tagline');
  assert.match(hero, /<h1>Easy UI<\/h1>/);
  assert.match(hero, /class="btn btn--primary"/, 'primary accent button');
  assert.match(hero, /class="btn btn--secondary"/, 'secondary bordered button');
  const tiles = hero.match(/<ul class="strip[^"]*"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  assert.equal([...tiles.matchAll(/<li>/g)].length, 3, 'three feature tiles');
  assert.ok(hero.includes('26 tools'), 'hero says "26 tools"');
});

test('T036: sidebar uses the family groups and marks the section being read', () => {
  const html = page();
  const nav = html.slice(html.indexOf('id="sidenav"'), html.indexOf('<main'));
  const labels = [...nav.matchAll(/<p class="sidenav__label">([^<]+)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['// easy kit family', '// overview', '// guide', '// reference']);
  assert.match(html, /\.sidenav__item\.active \{[^}]*border-color: var\(--neon-line\)/, 'active item is an outlined pill');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.match(script, /IntersectionObserver/, 'the script marks the active item');
});

test('T036: the visuals are present, each with a text equivalent', () => {
  const html = page();
  const block = (id: string) => {
    const start = html.indexOf(`<section id="${id}"`);
    assert.ok(start > -1, `section #${id} exists`);
    return html.slice(start, html.indexOf('</section>', start));
  };
  // 1. How it works: request lane and return lane
  const how = block('how-it-works');
  assert.equal([...how.matchAll(/<ol class="flow/g)].length, 2, 'request lane + return lane');
  for (const t of ['Claude Code', 'localhost:8765/mcp', 'Docker', 'Playwright', 'Chromium', 'page under test', 'reports/', 'JSON', 'HTML']) {
    assert.ok(how.toLowerCase().includes(t.toLowerCase()), `how it works shows ${t}`);
  }
  // 2. A session: the tools in call order
  const sess = block('a-session');
  const order = ['ui_start_session', 'ui_navigate', 'ui_get_page_state', 'ui_click', 'ui_check', 'ui_assert', 'ui_wait_for', 'ui_end_session'];
  let at = sess.indexOf('<ol class="stages">');
  assert.ok(at > -1, 'session figure exists');
  for (const t of order) {
    const i = sess.indexOf(t, at);
    assert.ok(i > at, `${t} appears in session-flow order`);
    at = i;
  }
  // 3. Tools map: every tool as one chip, in 8 job groups
  const tools = block('tools');
  assert.equal([...tools.matchAll(/<div class="tgroup[ "]/g)].length, 8, 'eight job groups');
  const chips = [...tools.matchAll(/<li><code>(ui_[a-z_]+)<\/code><\/li>/g)].map((m) => m[1]);
  assert.deepEqual([...chips].sort(), [...registeredTools()].sort(), 'chips are exactly the registered tools');
  // 4. Before / after
  const ba = block('before-after');
  assert.equal([...ba.matchAll(/class="side side--before"/g)].length, 2);
  assert.equal([...ba.matchAll(/class="side side--after"/g)].length, 2);
  assert.ok(ba.includes('>before<') && ba.includes('>after<'), 'sides are labelled in words, not only colour');
  // 5. Measured: only recorded numbers
  const m = block('measured');
  for (const n of ['357 KB', '4.0 KB', '33 ms', '185 ms', '303']) assert.ok(m.includes(n), `measured shows ${n}`);
  assert.equal([...m.matchAll(/<div class="bar[ "]/g)].length, 4, 'four bars');
  // 6. Several sessions
  const several = block('several-sessions');
  assert.equal([...several.matchAll(/class="session-card"/g)].length, 3, 'three session cards');
  for (const n of ['MAX_SESSIONS_PER_CONNECTION', '10 min', 'timed_out']) assert.ok(several.includes(n), `several sessions mentions ${n}`);
  // Every svg is decorative or labelled; no images.
  assert.doesNotMatch(html, /<img\b/i, 'no images');
  for (const svg of html.matchAll(/<svg\b[^>]*>/g)) assert.match(svg[0], /aria-hidden="true"|role="img"/, 'every svg is hidden or labelled');
  // Dense prose is folded.
  assert.ok([...html.matchAll(/<details class="more">\s*<summary>More detail<\/summary>/g)].length >= 8, 'long prose sits under "More detail"');
});
