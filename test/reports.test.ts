// T014 — rendering logic. `describe`, `groupIntoSteps`, and `formatDuration` are
// pure, so they are tested here without a browser or a session: these are the
// cheapest and highest-value tests in the task.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  describe,
  groupIntoSteps,
  formatDuration,
  writeReports,
  writeIndex,
  slugify,
  MAX_INDEX_ENTRIES,
} from "../src/reports/index.js";
import type { LoggedAction, SessionRecord } from "../src/tools/session.js";

const TMP_REPORTS_DIR = path.join(process.cwd(), "test", ".tmp-reports-t014");

test.after(() => {
  rmSync(TMP_REPORTS_DIR, { recursive: true, force: true });
});

function action(partial: Partial<LoggedAction> & { action: string }): LoggedAction {
  return { timestamp: "2026-08-17T10:00:00.000Z", ok: true, ...partial };
}

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "test-id",
    target: "test target",
    status: "passed",
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: "2026-08-17T10:00:05.000Z",
    actions: [],
    ...partial,
  };
}

// --- describe(): a readable sentence per action ---

test("describe renders each action type as a sentence, never a JSON dump", () => {
  assert.equal(describe(action({ action: "ui_step", args: { label: "Log in" } })), "Log in");
  assert.equal(
    describe(action({ action: "ui_navigate", args: { url: "http://localhost:8080" } })),
    "Opened http://localhost:8080"
  );
  assert.equal(describe(action({ action: "ui_click", args: { selector: "#save" } })), "Clicked #save");
  assert.equal(
    describe(action({ action: "ui_fill", args: { selector: "#user", value: "jcarlin" } })),
    "Filled #user"
  );
  assert.equal(describe(action({ action: "ui_assert", args: { condition: "x === 1" } })), "Asserted x === 1");
  assert.equal(describe(action({ action: "ui_check", args: { condition: "y" } })), "Checked y");
  assert.equal(describe(action({ action: "ui_wait_for", args: { condition: "z" } })), "Waited for z");
  assert.equal(describe(action({ action: "ui_take_screenshot" })), "Took a screenshot");
});

test("describe truncates a very long value so one action stays one line", () => {
  const url = `http://localhost:8080/${"x".repeat(400)}`;
  const text = describe(action({ action: "ui_navigate", args: { url } }));
  assert.ok(text.length < 200, `expected a truncated line, got ${text.length} chars`);
  assert.match(text, /… \(422 chars\)$/);
});

test("describe falls back to the tool name for an unknown action, and never throws on missing args", () => {
  assert.equal(describe(action({ action: "android_tap" })), "android_tap");
  assert.equal(describe(action({ action: "ui_click" })), "Clicked an element");
  assert.equal(describe(action({ action: "ui_navigate" })), "Opened the page");
});

test("describe renders a readable sentence for each T019 interaction (AC7)", () => {
  assert.equal(
    describe(action({ action: "ui_select_option", args: { selector: "#country", value: "Vietnam" } })),
    'Selected "Vietnam" in #country'
  );
  assert.equal(
    describe(action({ action: "ui_press_key", args: { key: "Enter", selector: "#q" } })),
    "Pressed Enter in #q"
  );
  assert.equal(describe(action({ action: "ui_press_key", args: { key: "Escape" } })), "Pressed Escape");
  assert.equal(describe(action({ action: "ui_hover", args: { selector: "#menu" } })), "Hovered over #menu");
  assert.equal(
    describe(action({ action: "ui_set_checked", args: { selector: "#terms", checked: true } })),
    "Set #terms to checked"
  );
  assert.equal(
    describe(action({ action: "ui_set_checked", args: { selector: "#terms", checked: false } })),
    "Set #terms to unchecked"
  );
  assert.equal(describe(action({ action: "ui_scroll", args: { selector: "#footer" } })), "Scrolled #footer into view");
  assert.equal(describe(action({ action: "ui_scroll" })), "Scrolled down one page");
});

test("describe truncates long values in the T019 sentences and keeps them to one line (AC7)", () => {
  const long = "x".repeat(500);
  const text = describe(action({ action: "ui_select_option", args: { selector: "#s", value: long } }));
  assert.ok(text.length < 250, `expected a bounded sentence, got ${text.length} chars`);
  assert.match(text, /500 chars/);
});

// --- groupIntoSteps() ---

test("actions are grouped under the step label in force when they were recorded", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_step", args: { label: "Log in" }, step: "Log in" }),
    action({ action: "ui_fill", step: "Log in" }),
    action({ action: "ui_step", args: { label: "Toggle" }, step: "Toggle" }),
    action({ action: "ui_click", step: "Toggle" }),
    action({ action: "ui_assert", step: "Toggle" }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Log in");
  assert.equal(groups[0].actions.length, 2);
  assert.equal(groups[1].label, "Toggle");
  assert.equal(groups[1].actions.length, 3);
});

test("a session with no ui_step calls renders as one implicit group", () => {
  const groups = groupIntoSteps([action({ action: "ui_navigate" }), action({ action: "ui_click" })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, undefined);
  assert.equal(groups[0].actions.length, 2);
});

test("actions before the first ui_step stay in their own leading group", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_navigate" }),
    action({ action: "ui_step", args: { label: "Log in" }, step: "Log in" }),
    action({ action: "ui_fill", step: "Log in" }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, undefined, "leading actions must not be absorbed into the first label");
  assert.equal(groups[0].actions.length, 1);
  assert.equal(groups[1].label, "Log in");
});

test("two consecutive ui_step calls with nothing between them each get their own group", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_step", args: { label: "A" }, step: "A" }),
    action({ action: "ui_step", args: { label: "B" }, step: "B" }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["A", "B"]
  );
});

test("repeated ui_step labels still start distinct groups", () => {
  const groups = groupIntoSteps([
    action({ action: "ui_step", args: { label: "Retry" }, step: "Retry" }),
    action({ action: "ui_click", step: "Retry" }),
    action({ action: "ui_step", args: { label: "Retry" }, step: "Retry" }),
    action({ action: "ui_assert", step: "Retry" }),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.actions.length), [2, 2]);
});

test("groupIntoSteps on an empty action list returns no groups", () => {
  assert.deepEqual(groupIntoSteps([]), []);
});

// --- formatDuration() ---

test("formatDuration renders ms under a second and seconds above it", () => {
  assert.equal(formatDuration("2026-08-17T10:00:00.000Z", "2026-08-17T10:00:00.407Z"), "407ms");
  assert.equal(formatDuration("2026-08-17T10:00:00.000Z", "2026-08-17T10:00:05.000Z"), "5.0s");
});

test("formatDuration returns undefined rather than NaN when an endpoint is missing", () => {
  assert.equal(formatDuration("2026-08-17T10:00:00.000Z", undefined), undefined);
  assert.equal(formatDuration(undefined, "2026-08-17T10:00:00.000Z"), undefined);
  assert.equal(formatDuration("not-a-date", "2026-08-17T10:00:00.000Z"), undefined);
});

// --- rendered document ---

test("the report leads with a verdict summary, not the raw log", async () => {
  const { htmlPath } = await writeReports(
    record({
      actions: [
        action({ action: "ui_step", args: { label: "Log in" }, step: "Log in" }),
        action({ action: "ui_fill", args: { selector: "#user", value: "jcarlin" }, step: "Log in" }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /verdict-box passed/);
  assert.match(html, /1 step\(s\) · 2 actions · 0 failed/);
  assert.match(html, /took 5\.0s/);
  assert.match(html, /Log in/);
  assert.match(html, /Filled #user/);
  assert.doesNotMatch(html, /jcarlin/, "filled values must not leak into the HTML report");
  // Raw log present but demoted.
  assert.match(html, /<details>[\s\S]*Raw action log \(2\)/);
});

test("a step containing a hard failure is marked failed; a soft check alone is not", async () => {
  const { htmlPath } = await writeReports(
    record({
      status: "failed",
      actions: [
        action({ action: "ui_step", args: { label: "Soft only" }, step: "Soft only" }),
        action({ action: "ui_check", ok: false, soft: true, detail: "Check evaluated false", step: "Soft only" }),
        action({ action: "ui_step", args: { label: "Hard fail" }, step: "Hard fail" }),
        action({ action: "ui_assert", ok: false, detail: "Assertion evaluated false", step: "Hard fail" }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /section class="step soft"[\s\S]*PASSED \(with checks\)/);
  assert.match(html, /section class="step fail"[\s\S]*FAILED/);
});

test("step labels and details are HTML-escaped", async () => {
  const { htmlPath } = await writeReports(
    record({
      actions: [
        action({
          action: "ui_step",
          args: { label: "<script>alert(1)</script>" },
          step: "<script>alert(1)</script>",
        }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("T019 action sentences are HTML-escaped in the rendered report (AC7)", async () => {
  const { htmlPath } = await writeReports(
    record({
      actions: [
        action({ action: "ui_select_option", args: { selector: "#s", value: "<img src=x onerror=alert(1)>" } }),
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Selected &quot;&lt;img src=x onerror=alert\(1\)&gt;&quot; in #s/);
});

test("browser problems are listed and explicitly do not change the verdict", async () => {
  const { htmlPath } = await writeReports(
    record({
      status: "passed",
      actions: [action({ action: "ui_navigate" })],
      issues: [
        { timestamp: "2026-08-17T10:00:01.000Z", kind: "console", text: "TypeError: boom" },
        {
          timestamp: "2026-08-17T10:00:02.000Z",
          kind: "requestfailed",
          text: "GET http://x/api — net::ERR_FAILED",
        },
      ],
    }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /Browser problems \(2\)/);
  assert.match(html, /TypeError: boom/);
  assert.match(html, /net::ERR_FAILED/);
  assert.match(html, /do not change the session verdict/);
  assert.match(html, /verdict-box passed/, "console errors must not flip the verdict");
});

test("a session that never ended renders 'unknown' duration, not NaN", async () => {
  const { htmlPath } = await writeReports(
    record({ endedAt: undefined, actions: [action({ action: "ui_navigate" })] }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  assert.match(html, /took unknown/);
  assert.doesNotMatch(html, /NaN/);
});

test("the report is self-contained: no external requests", async () => {
  const { htmlPath } = await writeReports(
    record({ actions: [action({ action: "ui_navigate", args: { url: "http://localhost:8080/app" } })] }),
    TMP_REPORTS_DIR
  );
  const html = readFileSync(htmlPath, "utf8");

  // The only http(s) strings allowed are ones the session itself recorded (the
  // navigated URL), never a stylesheet/script/font the browser would go fetch.
  assert.doesNotMatch(html, /<link[^>]+href="https?:/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /@import/);
});

test("a 120-action session still renders", async () => {
  const many: LoggedAction[] = [];
  for (let i = 0; i < 120; i += 1) {
    if (i % 20 === 0) {
      many.push(action({ action: "ui_step", args: { label: `Step ${i / 20}` }, step: `Step ${i / 20}` }));
    }
    many.push(action({ action: "ui_click", args: { selector: `#el-${i}` }, step: `Step ${Math.floor(i / 20)}` }));
  }

  const { htmlPath } = await writeReports(record({ actions: many }), TMP_REPORTS_DIR);
  assert.ok(existsSync(htmlPath));
  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /Raw action log \(126\)/);
});


// --- T021: readable filenames + reports/index.html (always a temp dir, never the real reports/) ---

const freshDirs: string[] = [];

test.after(() => {
  for (const dir of freshDirs) rmSync(dir, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "t021-reports-"));
  freshDirs.push(dir);
  return dir;
}

test("slugify: lower-case, symbols collapse to '-', trimmed, <=40 chars, 'untitled' when empty", () => {
  assert.equal(slugify("Login flow / happy path"), "login-flow-happy-path");
  assert.equal(slugify("<script>alert(1)</script>"), "script-alert-1-script");
  assert.equal(slugify(""), "untitled");
  assert.equal(slugify("  !!! ???  "), "untitled");
  assert.equal(slugify("a".repeat(100)), "a".repeat(40));
  assert.doesNotMatch(slugify("ab-".repeat(30)), /-$/, "truncation must not leave a trailing dash");
  assert.match(slugify("Đăng nhập thành công"), /^[a-z0-9]+(-[a-z0-9]+)*$/, "non-ASCII input yields an ASCII-safe slug");
  assert.match(slugify("日本語"), /^untitled$/);
  assert.equal(slugify("Đăng nhập thành công"), "dang-nhap-thanh-cong");
  assert.equal(slugify("đường Đức"), "duong-duc");
});

test("new reports are named session-<UTC start>-<slug>-<id8>.{json,html} and the JSON keeps the full id", async () => {
  const dir = freshDir();
  const id = "3f2a9c1e-7b4d-4e8a-9a10-5d6c2b7e1f00";
  const { jsonPath, htmlPath } = await writeReports(
    record({ id, target: "Login flow / happy path", startedAt: "2026-10-30T09:15:42.000Z" }),
    dir
  );
  assert.equal(path.basename(jsonPath), "session-20261030-091542-login-flow-happy-path-3f2a9c1e.json");
  assert.equal(path.basename(htmlPath), "session-20261030-091542-login-flow-happy-path-3f2a9c1e.html");
  assert.ok(existsSync(jsonPath) && existsSync(htmlPath));
  assert.equal(JSON.parse(readFileSync(jsonPath, "utf8")).id, id);
});

test("two same-second same-target sessions get distinct files (id8)", async () => {
  const dir = freshDir();
  const a = await writeReports(record({ id: "aaaaaaaa-1111" }), dir);
  const b = await writeReports(record({ id: "bbbbbbbb-2222" }), dir);
  assert.notEqual(a.jsonPath, b.jsonPath);
});

test("index.html lists legacy and new sessions newest first, skips corrupt JSON, links the HTML reports", async () => {
  const dir = freshDir();
  const legacyId = "11111111-2222-3333-4444-555555555555";
  writeFileSync(
    path.join(dir, `session-${legacyId}.json`),
    JSON.stringify(record({ id: legacyId, target: "Legacy run", status: "failed", startedAt: "2026-08-01T08:00:00.000Z", actions: [action({ action: "ui_click" }), action({ action: "ui_click" })] }))
  );
  writeFileSync(path.join(dir, `session-${legacyId}.html`), "<html></html>");
  writeFileSync(path.join(dir, "session-x.json"), "{ not json");
  writeFileSync(path.join(dir, "screenshot-abc.png"), "png");
  writeFileSync(path.join(dir, "notes.json"), JSON.stringify({ hello: "world" }));

  const { htmlPath } = await writeReports(
    record({ id: "deadbeef-0000", target: "Login flow / happy path", startedAt: "2026-10-30T09:15:42.000Z" }),
    dir
  );

  const indexPath = path.join(dir, "index.html");
  assert.ok(existsSync(indexPath));
  const html = readFileSync(indexPath, "utf8");

  assert.ok(html.indexOf("Login flow / happy path") < html.indexOf("Legacy run"), "newest first");
  assert.equal((html.match(/<tr class="session"/g) ?? []).length, 2);
  assert.ok(html.includes(`href="${path.basename(htmlPath)}"`));
  assert.ok(html.includes(`href="session-${legacyId}.html"`));
  assert.match(html, /<span class="gm-warn-text">failed<\/span>/);
  assert.match(html, />passed</);
  assert.doesNotMatch(html, /session-x|notes\.json|screenshot-abc/);
  // The legacy record had 2 actions; the new one 0.
  assert.match(html, /Legacy run[\s\S]*?<td class="gm-mono gm-num">2<\/td>/);
});

test("index.html is self-contained and escapes session-derived text", async () => {
  const dir = freshDir();
  const { htmlPath } = await writeReports(
    record({ id: "cafebabe-0000", target: "<script>alert(1)</script>" }),
    dir
  );
  assert.equal(path.basename(htmlPath).split("-").slice(3).join("-"), "script-alert-1-script-cafebabe.html");
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
  assert.doesNotMatch(html, /<script[^>]*src=/);
  assert.doesNotMatch(html, /@import/);
});

test("an index-write failure never fails writeReports", async () => {
  const dir = freshDir();
  mkdirSync(path.join(dir, "index.html")); // index.html is a directory -> rename onto it fails
  const { jsonPath, htmlPath } = await writeReports(record({ id: "feedface-0000" }), dir);
  assert.ok(existsSync(jsonPath) && existsSync(htmlPath));
});

test("the index lists at most the newest MAX_INDEX_ENTRIES sessions and says so", async () => {
  const dir = freshDir();
  assert.equal(MAX_INDEX_ENTRIES, 500);
  for (let i = 0; i < 503; i += 1) {
    const id = `${String(i).padStart(8, "0")}-0000`;
    const startedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    writeFileSync(path.join(dir, `session-${id}.json`), JSON.stringify(record({ id, target: `run ${i}`, startedAt })));
  }
  await writeIndex(dir);
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  assert.equal((html.match(/<tr class="session"/g) ?? []).length, 500);
  assert.match(html, /Showing the newest 500 of 503 sessions/);
  assert.match(html, />run 502</, "newest is listed");
  assert.doesNotMatch(html, />run 2</, "the oldest are dropped");
});

test("a session whose .html sibling is missing is listed without a link", async () => {
  const dir = freshDir();
  const id = "99999999-0000-1111-2222-333333333333";
  writeFileSync(
    path.join(dir, `session-${id}.json`),
    JSON.stringify(record({ id, target: "Orphan json", startedAt: "2026-08-01T08:00:00.000Z" }))
  );
  await writeReports(record({ id: "abcdabcd-0000", target: "Has html" }), dir);
  const html = readFileSync(path.join(dir, "index.html"), "utf8");

  assert.doesNotMatch(html, new RegExp(`href="session-${id}\\.html"`), "no dead link");
  assert.match(html, /Orphan json[\s\S]*?no HTML report/);
  assert.match(html, /href="session-[^"]*has-html-abcdabcd\.html"/, "sessions with an HTML report still link");
});

// --- T024: Graphite Mint restyle of index.html (temp dirs only) ---

/** The Graphite Mint values (tokens.json) for every token the index page declares. Copied here so the
 * test never reads outside the repo; a drifting value in the page fails AC10(b). */
const GRAPHITE_MINT_TOKENS: Record<string, string> = {
  bg: "#121413",
  "bg-sunken": "#0E100F",
  "bg-raised": "#181B1A",
  "line-subtle": "#1F2321",
  line: "#262B29",
  "text-strong": "#EAEDEA",
  text: "#DCE0DD",
  "text-2": "#ABB3AE",
  "text-muted": "#8C9590",
  "text-dim": "#6E7772",
  accent: "#7EDDB0",
  "accent-hover": "#B2EDCF",
  neon: "#3CF5A8",
  warn: "#E3B66B",
  "glow-text": "0 0 12px rgba(60, 245, 168, 0.35)",
  "space-2": "8px",
  "space-4": "16px",
  "space-6": "24px",
  "space-7": "32px",
  "space-9": "48px",
  "radius-md": "8px",
  "content-max": "920px",
  "font-sans": '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  "font-mono": '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
};

async function renderedIndex(
  sessions: Array<Partial<SessionRecord> & { id: string }>,
  extraFiles: Record<string, string> = {}
): Promise<string> {
  const dir = freshDir();
  for (const [name, contents] of Object.entries(extraFiles)) writeFileSync(path.join(dir, name), contents);
  for (const s of sessions) await writeReports(record(s), dir);
  await writeIndex(dir);
  return readFileSync(path.join(dir, "index.html"), "utf8");
}

function styleOf(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "index has an inline <style>");
  return m[1];
}

/** The `:root { ... }` block and the CSS with that block removed. */
function splitRoot(css: string): { root: string; rest: string } {
  const m = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(m, "index CSS declares tokens on :root");
  return { root: m[1], rest: css.replace(m[0], "") };
}

const MIXED_SESSIONS = [
  { id: "aaaaaaaa-0001", target: "Login flow", status: "passed" as const, startedAt: "2026-10-30T09:15:42.000Z" },
  { id: "bbbbbbbb-0002", target: "Checkout", status: "failed" as const, startedAt: "2026-10-29T08:02:11.000Z" },
  { id: "cccccccc-0003", target: "Search", status: "passed" as const, startedAt: "2026-10-28T08:02:11.000Z" },
];

test("T024 AC10a: no raw colour value outside the :root token block", async () => {
  const { rest } = splitRoot(styleOf(await renderedIndex(MIXED_SESSIONS)));
  assert.doesNotMatch(rest, /#[0-9a-fA-F]{3,8}\b/, "no hex colour in component rules");
  assert.doesNotMatch(rest, /\b(rgba?|hsla?)\(/i, "no rgb()/hsl() in component rules");
});

test("T024 AC10b/AC1: every :root token has exactly the Graphite Mint value, and every var(--x) is declared", async () => {
  const { root, rest } = splitRoot(styleOf(await renderedIndex(MIXED_SESSIONS)));
  const declared = new Map<string, string>();
  for (const m of root.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) declared.set(m[1], m[2].trim());
  assert.ok(declared.size > 0);
  for (const [name, value] of declared) {
    assert.ok(name in GRAPHITE_MINT_TOKENS, `--${name} is a known Graphite Mint token`);
    assert.equal(value.toLowerCase(), GRAPHITE_MINT_TOKENS[name].toLowerCase(), `--${name} value`);
  }
  for (const m of rest.matchAll(/var\(--([a-z0-9-]+)/g)) {
    // --cols is the StatStrip's own parameter, set inline on the strip, not a token.
    if (m[1] === "cols") continue;
    assert.ok(declared.has(m[1]), `var(--${m[1]}) is declared on :root`);
  }
});

test("T024 AC2/AC7: weights 400/500/600 only, no all-caps, no gradients or drop shadows, never #000/#fff", async () => {
  const css = styleOf(await renderedIndex(MIXED_SESSIONS));
  for (const m of css.matchAll(/font(?:-weight)?\s*:\s*(\d{3})\b/g)) assert.ok(["400", "500", "600"].includes(m[1]), `weight ${m[1]}`);
  assert.doesNotMatch(css, /text-transform|uppercase|small-caps/i);
  assert.doesNotMatch(css, /gradient/i);
  for (const m of css.matchAll(/(?:box|text)-shadow\s*:\s*([^;]+);/g)) assert.match(m[1], /var\(--glow-text\)/, "shadows are the neon glow only");
  assert.doesNotMatch(css, /#000\b|#000000|#fff\b|#ffffff/i);
  assert.match(css, /\.gm-page\s*\{[^}]*background:\s*var\(--bg\)/);
});

test("T024 AC3: header has the mono eyebrow, the app-title h1 and a lede", async () => {
  const html = await renderedIndex(MIXED_SESSIONS);
  assert.match(html, /<p class="gm-eyebrow">&gt; easy-ui-mcp reports<\/p>/);
  assert.match(html, /<h1>Session reports<\/h1>/);
  assert.match(html, /<p class="lede">/);
  const css = styleOf(html);
  assert.match(css, /h1\s*\{[^}]*font:\s*600 28px\/1\.2 var\(--font-sans\)[^}]*color:\s*var\(--text-strong\)/);
  assert.match(css, /\.lede\s*\{[^}]*color:\s*var\(--text-2\)/);
});

test("T024 AC4/AC10c: a 4-column StatStrip with exactly one key number (the session count)", async () => {
  const html = await renderedIndex(MIXED_SESSIONS);
  assert.match(html, /<div class="gm-strip" style="--cols:4">/);
  assert.equal((html.match(/class="gm-strip__num gm-strip__num--key"/g) ?? []).length, 1);
  assert.equal((html.match(/class="gm-strip__num/g) ?? []).length, 4);
  assert.match(html, /gm-strip__num--key">3<\/div>\s*<div class="gm-strip__label">sessions<\/div>/);
  assert.match(html, /gm-strip__num">2<\/div>\s*<div class="gm-strip__label">passed<\/div>/);
  assert.match(html, /gm-strip__num">1<\/div>\s*<div class="gm-strip__label">failed<\/div>/);
  assert.match(html, /2026-10-30[\s\S]*?<div class="gm-strip__label">newest run/);
  for (const m of html.matchAll(/class="gm-strip__label">([^<]+)</g)) assert.equal(m[1], m[1].toLowerCase(), "labels are lowercase");
});

test("T024 AC4/edge: with no sessions the strip says 'no data' (not 0) and the table has one muted row", async () => {
  const html = await renderedIndex([]);
  assert.equal((html.match(/class="gm-nodata gm-strip__num/g) ?? []).length, 4, "all four cells read no data");
  assert.doesNotMatch(html, /gm-strip__num[^"]*">0</);
  assert.doesNotMatch(html, /class="gm-strip__num gm-strip__num--key"/, "no neon on 'no data'");
  assert.match(html, /<td colspan="5"><span class="gm-nodata">no sessions yet<\/span><\/td>/);
  assert.doesNotMatch(html, /<tr class="session"/);
});

test("T024 AC5/AC10d: DataTable markup; failed is a plain word in gm-warn-text, passed and other are plain; no row fills", async () => {
  const html = await renderedIndex([
    ...MIXED_SESSIONS,
    { id: "dddddddd-0004", target: "Slow", status: "timeout" as unknown as "passed", startedAt: "2026-10-27T08:02:11.000Z" },
  ]);
  assert.match(html, /<div class="gm-table-wrap">\s*<table class="gm-table">/);
  assert.match(html, /<th>started \(utc\)<\/th><th>target<\/th><th>status<\/th><th class="gm-num">actions<\/th><th>report<\/th>/);
  assert.match(html, /<td class="gm-mono">2026-10-29T08:02:11\.000Z<\/td>/);
  assert.match(html, /Checkout[\s\S]*?<span class="gm-warn-text">failed<\/span>/);
  assert.equal((html.match(/gm-warn-text">/g) ?? []).length, 1, "only the one failed session is warned");
  assert.match(html, /<td class="gm-mono">passed<\/td>/);
  assert.match(html, /<td class="gm-mono">timeout<\/td>/);
  assert.doesNotMatch(html, /status-(passed|failed|other)|tr\.(passed|failed)/);
});

test("T024 AC6: report links use gm-link, the missing-report note uses gm-nodata, links get a neon focus ring", async () => {
  const id = "99999999-0000-1111-2222-333333333333";
  const html = await renderedIndex(MIXED_SESSIONS, {
    [`session-${id}.json`]: JSON.stringify(record({ id, target: "Orphan json", startedAt: "2026-08-01T08:00:00.000Z" })),
  });
  assert.match(html, /<a class="gm-link" href="session-[^"]*login-flow-aaaaaaaa\.html">report<\/a>/);
  assert.match(html, /<span class="gm-nodata">no HTML report<\/span>/);
  const css = styleOf(html);
  assert.match(css, /\.gm-link\s*\{[^}]*color:\s*var\(--accent\)/);
  assert.match(css, /\.gm-link:hover\s*\{[^}]*color:\s*var\(--accent-hover\)/);
  assert.match(css, /\.gm-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--neon\);[^}]*outline-offset:\s*2px/);
});

test("T024 AC7: neon is used only by the eyebrow, the key number and the focus ring", async () => {
  const css = styleOf(await renderedIndex(MIXED_SESSIONS));
  const owners: string[] = [];
  for (const m of css.replace(/:root\s*\{[^}]*\}/, "").matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/var\(--neon\)/.test(m[2])) owners.push(m[1].trim());
  }
  assert.deepEqual(owners.sort(), [".gm-eyebrow", ".gm-link:focus-visible", ".gm-strip__num--key"].sort());
});

test("T024 AC8: responsive rules: 2-column strip below 720px, scrolling table wrap, >=16px gutter, content-max column", async () => {
  const css = styleOf(await renderedIndex(MIXED_SESSIONS));
  assert.match(css, /@media \(max-width:\s*719px\)\s*\{[^@]*\.gm-strip\s*\{[^}]*repeat\(2,/);
  assert.match(css, /\.gm-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.page\s*\{[^}]*max-width:\s*var\(--content-max\)[^}]*padding:\s*var\(--space-9\) var\(--space-4\)/);
  // Only the target cell may break anywhere (long URLs); status words and times must never split mid-word.
  assert.match(css, /td:nth-child\(2\)\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.gm-table th, \.gm-table td\s*\{[^}]*white-space:\s*nowrap/);
  assert.equal((css.match(/overflow-wrap/g) ?? []).length, 1);
});

test("T024: session-derived text is still escaped in the restyled markup", async () => {
  const html = await renderedIndex([{ id: "cafebabe-0001", target: '<img src=x onerror="1">', status: "<b>" as unknown as "passed" }]);
  assert.doesNotMatch(html, /<img src=x|<b>/);
  assert.match(html, /&lt;img src=x onerror=&quot;1&quot;&gt;/);
  assert.match(html, /&lt;b&gt;/);
});
