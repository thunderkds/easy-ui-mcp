// JSON + self-contained HTML report generation for a completed ui_session.
// T003 — see tasks/TASK_GUIDE_T003.md.

import { mkdir, writeFile, rename, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { LoggedAction, SessionRecord } from "../tools/session.js";

export interface ReportPaths {
  jsonPath: string;
  htmlPath: string;
}

/** Longest slug kept in a report filename. */
const MAX_SLUG_LENGTH = 40;

/** Newest sessions listed in `index.html`; older ones stay on disk, unlisted. */
export const MAX_INDEX_ENTRIES = 500;

/**
 * Filename-safe, human-readable form of a session target: ASCII lower-case,
 * diacritics folded, every run of other characters collapsed to one `-`.
 */
export function slugify(target: string): string {
  const slug = target
    // Vietnamese đ/Đ is a letter in its own right, not a base + combining mark, so NFD leaves it.
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug === "" ? "untitled" : slug;
}

/** `session-<YYYYMMDD-HHMMSS UTC of start>-<slug>-<first 8 of id>`: says when and what. */
function reportBaseName(record: SessionRecord): string {
  const started = new Date(record.startedAt);
  const when = Number.isNaN(started.getTime()) ? new Date() : started;
  const stamp = when.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const id8 = record.id.slice(0, 8).replace(/[^A-Za-z0-9-]/g, "_");
  return `session-${stamp}-${slugify(record.target)}-${id8}`;
}

/**
 * Write `record` to `reportsDir` as both a JSON report and a self-contained
 * HTML report (screenshots embedded as base64 data URIs), then refresh
 * `index.html`. Writes go to a temp file first and are then renamed into place,
 * so a container restart mid-write can never leave a corrupt/partial report at
 * the final path (Edge Case Checklist). The index is best effort: its failure is
 * logged and never fails the report.
 */
export async function writeReports(record: SessionRecord, reportsDir: string): Promise<ReportPaths> {
  await mkdir(reportsDir, { recursive: true });

  const base = reportBaseName(record);
  const jsonPath = path.join(reportsDir, `${base}.json`);
  const htmlPath = path.join(reportsDir, `${base}.html`);

  await atomicWrite(jsonPath, JSON.stringify(record, null, 2));
  await atomicWrite(htmlPath, await renderHtml(record));

  try {
    await writeIndex(reportsDir);
  } catch (error) {
    console.error(`could not update ${path.join(reportsDir, "index.html")}:`, error);
  }

  return { jsonPath, htmlPath };
}

async function atomicWrite(finalPath: string, contents: string): Promise<void> {
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmpPath, contents, "utf8");
  try {
    await rename(tmpPath, finalPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

interface IndexEntry {
  htmlFile: string;
  hasHtml: boolean;
  target: string;
  status: string;
  startedAt: string;
  startedMs: number;
  actionCount: number;
}

async function readIndexEntry(dir: string, file: string, present: Set<string>): Promise<IndexEntry | undefined> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as Partial<SessionRecord>;
    const htmlFile = file.replace(/\.json$/, ".html");
    const startedMs = typeof raw.startedAt === "string" ? Date.parse(raw.startedAt) : NaN;
    if (typeof raw.id !== "string" || Number.isNaN(startedMs)) return undefined;
    return {
      htmlFile,
      hasHtml: present.has(htmlFile),
      target: typeof raw.target === "string" ? raw.target : "",
      status: typeof raw.status === "string" ? raw.status : "unknown",
      startedAt: raw.startedAt as string,
      startedMs,
      actionCount: Array.isArray(raw.actions) ? raw.actions.length : 0,
    };
  } catch {
    // Unreadable or corrupt — not listable, but never fatal.
    return undefined;
  }
}

/**
 * (Re)write `<reportsDir>/index.html`: one row per `session-*.json`, newest first,
 * capped at MAX_INDEX_ENTRIES. Only the few fields the table needs are kept from
 * each file; screenshots are never loaded.
 */
export async function writeIndex(reportsDir: string): Promise<void> {
  const names = await readdir(reportsDir);
  const present = new Set(names);
  const files = names.filter((f) => /^session-.+\.json$/.test(f));
  const parsed = await Promise.all(files.map((f) => readIndexEntry(reportsDir, f, present)));
  const entries = parsed
    .filter((e): e is IndexEntry => e !== undefined)
    .sort((a, b) => b.startedMs - a.startedMs || (a.htmlFile < b.htmlFile ? 1 : -1));
  await atomicWrite(path.join(reportsDir, "index.html"), renderIndex(entries));
}

/**
 * The Graphite Mint stylesheet (the Easy Kit family design system), inlined so the index stays a
 * single self-contained file. Tokens are declared once on :root with the exact values from the design
 * system's tokens.json; every rule below references them with var(--…) and carries no raw colour.
 * The `gm-*` rules are copied from the design system's components/bundle.css (StatStrip, DataTable,
 * link, eyebrow, no-data, warn text); only `.page`, `h1`, `.lede`, `.gm-num` and the small-screen rules
 * are this page's own. Fonts are the token families with system fallbacks: nothing is fetched (FR-005).
 */
const INDEX_CSS = `
  :root {
    --bg: #121413;
    --bg-sunken: #0E100F;
    --bg-raised: #181B1A;
    --line-subtle: #1F2321;
    --line: #262B29;
    --text-strong: #EAEDEA;
    --text: #DCE0DD;
    --text-2: #ABB3AE;
    --text-muted: #8C9590;
    --text-dim: #6E7772;
    --accent: #7EDDB0;
    --accent-hover: #B2EDCF;
    --neon: #3CF5A8;
    --warn: #E3B66B;
    --glow-text: 0 0 12px rgba(60, 245, 168, 0.35);
    --space-2: 8px;
    --space-4: 16px;
    --space-6: 24px;
    --space-7: 32px;
    --space-9: 48px;
    --radius-md: 8px;
    --content-max: 920px;
    --font-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  }
  html { background: var(--bg); color-scheme: dark; }
  body { margin: 0; }

  .gm-page { background: var(--bg); color: var(--text); font: 400 15px/1.6 var(--font-sans); -webkit-font-smoothing: antialiased; }
  .gm-eyebrow { font: 400 12.5px/1.4 var(--font-mono); color: var(--neon); text-shadow: var(--glow-text); margin: 0; }
  .gm-link { color: var(--accent); text-decoration: none; }
  .gm-link:hover { color: var(--accent-hover); text-decoration: underline; text-underline-offset: 3px; }
  .gm-link:focus-visible { outline: 2px solid var(--neon); outline-offset: 2px; }

  .page { max-width: var(--content-max); margin: 0 auto; padding: var(--space-9) var(--space-4); }
  .page h1 { font: 600 28px/1.2 var(--font-sans); letter-spacing: -0.01em; color: var(--text-strong); margin: var(--space-2) 0; }
  .lede { font: 400 17px/1.6 var(--font-sans); color: var(--text-2); max-width: 680px; margin: 0 0 var(--space-7); }

  .gm-strip { display: grid; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; margin-bottom: var(--space-6); }
  .gm-strip > * { padding: 20px 22px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .gm-strip > * + * { border-left: 1px solid var(--line); }
  .gm-strip__num { font: 500 28px/1.1 var(--font-mono); color: var(--text-strong); }
  .gm-strip__num--key { color: var(--neon); text-shadow: var(--glow-text); }
  .gm-strip__num--text { font-size: 17px; line-height: 31px; }
  .gm-strip__label { font: 400 13.5px/1.5 var(--font-sans); color: var(--text-muted); }

  .gm-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius-md); }
  .gm-table { width: 100%; border-collapse: collapse; font: 400 14px/1.5 var(--font-sans); }
  .gm-table th { text-align: left; font: 500 12px/1.4 var(--font-mono); color: var(--text-muted); padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--bg-sunken); }
  .gm-table td { padding: 12px 16px; border-bottom: 1px solid var(--line-subtle); color: var(--text); vertical-align: top; }
  .gm-table th, .gm-table td { white-space: nowrap; }
  .gm-table td:nth-child(2) { white-space: normal; min-width: 220px; overflow-wrap: anywhere; }
  .gm-table tr:last-child td { border-bottom: 0; }
  .gm-table tbody tr:hover td { background: var(--bg-raised); }
  .gm-table .gm-mono { font-family: var(--font-mono); font-size: 13px; }
  .gm-table .gm-num { text-align: right; }
  .gm-nodata { color: var(--text-dim); font-family: var(--font-mono); }
  .gm-warn-text { color: var(--warn); }

  @media (min-width: 720px) {
    .page { padding-left: var(--space-7); padding-right: var(--space-7); }
  }
  @media (max-width: 719px) {
    .gm-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gm-strip > :nth-child(3) { border-left: 0; }
    .gm-strip > :nth-child(n+3) { border-top: 1px solid var(--line); }
    .gm-table td a { display: inline-block; padding: 12px 0; margin: -12px 0; }
  }
`;

function renderIndex(all: IndexEntry[]): string {
  const shown = all.slice(0, MAX_INDEX_ENTRIES);
  const rows = shown.map((e) => {
    const status = e.status === "failed" ? `<span class="gm-warn-text">failed</span>` : escapeHtml(e.status);
    return `
        <tr class="session">
          <td class="gm-mono">${escapeHtml(e.startedAt)}</td>
          <td>${escapeHtml(e.target || "(no label)")}</td>
          <td class="gm-mono">${status}</td>
          <td class="gm-mono gm-num">${e.actionCount}</td>
          <td>${e.hasHtml ? `<a class="gm-link" href="${escapeHtml(encodeURIComponent(e.htmlFile))}">report</a>` : `<span class="gm-nodata">no HTML report</span>`}</td>
        </tr>`;
  });
  const emptyRow = `
        <tr><td colspan="5"><span class="gm-nodata">no sessions yet</span></td></tr>`;

  const lede =
    all.length === 0
      ? "No sessions recorded yet."
      : all.length > shown.length
        ? `Showing the newest ${shown.length} of ${all.length} sessions; older reports are still on disk.`
        : "Every recorded session, newest first.";

  // A missing value reads "no data", never 0 (Graphite Mint StatStrip rule).
  const stat = (num: string, label: string): string =>
    `<div>
      ${num}
      <div class="gm-strip__label">${label}</div>
    </div>`;
  const noData = `<div class="gm-nodata gm-strip__num gm-strip__num--text">no data</div>`;
  const newest = all[0] ? new Date(all[0].startedMs).toISOString() : undefined;
  const strip =
    all.length === 0
      ? [stat(noData, "sessions"), stat(noData, "passed"), stat(noData, "failed"), stat(noData, "newest run")]
      : [
          stat(`<div class="gm-strip__num gm-strip__num--key">${all.length}</div>`, "sessions"),
          stat(`<div class="gm-strip__num">${all.filter((e) => e.status === "passed").length}</div>`, "passed"),
          stat(`<div class="gm-strip__num">${all.filter((e) => e.status === "failed").length}</div>`, "failed"),
          stat(`<div class="gm-strip__num gm-strip__num--text">${newest!.slice(0, 10)}</div>`, "newest run"),
        ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Session reports</title>
<style>${INDEX_CSS}</style>
</head>
<body class="gm-page">
  <main class="page">
    <p class="gm-eyebrow">&gt; easy-ui-mcp reports</p>
    <h1>Session reports</h1>
    <p class="lede">${lede}</p>
    <div class="gm-strip" style="--cols:4">
      ${strip.join("\n      ")}
    </div>
    <div class="gm-table-wrap">
      <table class="gm-table">
        <thead><tr><th>started (utc)</th><th>target</th><th>status</th><th class="gm-num">actions</th><th>report</th></tr></thead>
        <tbody>${rows.length > 0 ? rows.join("") : emptyRow}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Embeds each distinct screenshot's bytes exactly once, as a CSS class, and hands
 * back class names to reference it. Two different files with identical content
 * (the common case: a failure capture and a manual capture of the same screen)
 * therefore cost one copy, not two (NFR-008).
 */
class ScreenshotEmbedder {
  private readonly classByHash = new Map<string, string>();
  private readonly rules: string[] = [];

  async classFor(filePath: string): Promise<string | undefined> {
    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch {
      // Missing/unreadable — omit rather than failing the report.
      return undefined;
    }
    const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
    const existing = this.classByHash.get(hash);
    if (existing) return existing;

    const className = `shot-${hash}`;
    this.classByHash.set(hash, className);
    this.rules.push(
      `.${className} { background-image: url("data:image/png;base64,${data.toString("base64")}"); }`
    );
    return className;
  }

  styles(): string {
    return this.rules.join("\n");
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Row class + label for an action's outcome. A soft check that came back falsy
 * is neither a pass nor a failure — it is an observation, and must read as one. */
function outcome(action: LoggedAction): { cls: string; label: string } {
  if (action.ok) return { cls: "ok", label: "OK" };
  if (action.soft) return { cls: "soft", label: "CHECK" };
  return { cls: "fail", label: "FAIL" };
}

/** Long enough to identify a URL or selector, short enough to keep one action on
 * one line. A data: URL or a deep selector chain otherwise swamps the step. */
const MAX_DESCRIBED_VALUE = 120;

function truncate(value: string): string {
  return value.length <= MAX_DESCRIBED_VALUE
    ? value
    : `${value.slice(0, MAX_DESCRIBED_VALUE)}… (${value.length} chars)`;
}

function arg(action: LoggedAction, name: string): string | undefined {
  const value = action.args?.[name];
  const raw =
    typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
  return raw === undefined ? undefined : truncate(raw);
}

/**
 * A readable sentence for one action, derived deterministically from what was
 * recorded — no LLM, per the Critical Constraint. This is the single place any
 * phrasing lives, which is why it is pure and exported: it is the cheapest thing
 * in the renderer to unit-test.
 */
export function describe(action: LoggedAction): string {
  const selector = arg(action, "selector");
  const condition = arg(action, "condition");
  switch (action.action) {
    case "ui_step":
      return arg(action, "label") ?? "Step";
    case "ui_navigate":
      return `Opened ${arg(action, "url") ?? "the page"}`;
    case "ui_click":
      return `Clicked ${selector ?? "an element"}`;
    case "ui_fill":
      // Never repeat entered values in the human-facing report: inputs commonly
      // contain passwords, tokens, and other secrets. The selector is enough to
      // explain what happened and matches FR-017's deterministic example.
      return `Filled ${selector ?? "an input"}`;
    case "ui_assert":
      return `Asserted ${condition ?? "a condition"}`;
    case "ui_check":
      return `Checked ${condition ?? "a condition"}`;
    case "ui_wait_for":
      return `Waited for ${condition ?? "a condition"}`;
    case "ui_select_option":
      return `Selected "${arg(action, "value") ?? "an option"}" in ${selector ?? "a select"}`;
    case "ui_press_key": {
      const key = arg(action, "key") ?? "a key";
      return selector ? `Pressed ${key} in ${selector}` : `Pressed ${key}`;
    }
    case "ui_hover":
      return `Hovered over ${selector ?? "an element"}`;
    case "ui_set_checked":
      return `Set ${selector ?? "a checkbox"} to ${action.args?.checked === false ? "unchecked" : "checked"}`;
    case "ui_scroll":
      return selector ? `Scrolled ${selector} into view` : "Scrolled down one page";
    case "ui_get_page_state":
      return "Read the page state";
    case "ui_take_screenshot":
      return "Took a screenshot";
    default:
      return action.action;
  }
}

export interface StepGroup {
  label?: string;
  actions: LoggedAction[];
}

/**
 * Group actions under their step labels. Actions recorded before the first
 * `ui_step` belong to an implicit leading group (`label: undefined`) rather than
 * being absorbed into the first labelled step — they happened before it.
 */
export function groupIntoSteps(actions: LoggedAction[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const action of actions) {
    // A marker always starts a new step, even if the caller deliberately reuses
    // the previous label. Grouping by label alone would silently merge those two
    // distinct parts of the flow.
    if (action.action === "ui_step") {
      groups.push({ label: action.step ?? arg(action, "label"), actions: [action] });
      continue;
    }
    const last = groups[groups.length - 1];
    if (!last || last.label !== action.step) {
      groups.push({ label: action.step, actions: [action] });
      continue;
    }
    last.actions.push(action);
  }
  return groups;
}

/** Human-readable elapsed time between two ISO timestamps, or undefined if either
 * is missing (a timed-out session never gets an `endedAt`). */
export function formatDuration(fromIso?: string, toIso?: string): string | undefined {
  if (!fromIso || !toIso) return undefined;
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A step fails if it contains a hard failure; soft checks never fail a step,
 * mirroring how they never fail the session. */
function stepOutcome(group: StepGroup): { cls: string; label: string } {
  if (group.actions.some((a) => !a.ok && !a.soft)) return { cls: "fail", label: "FAILED" };
  if (group.actions.some((a) => !a.ok && a.soft)) return { cls: "soft", label: "PASSED (with checks)" };
  return { cls: "ok", label: "PASSED" };
}

async function renderHtml(record: SessionRecord): Promise<string> {
  const embedder = new ScreenshotEmbedder();

  // The raw log keeps every action verbatim, including ui_step markers — it is the
  // debugging view, so nothing is filtered or rephrased here.
  const rows = record.actions.map((action) => {
    const { cls, label } = outcome(action);
    return `
        <tr class="${cls}">
          <td>${escapeHtml(action.timestamp)}</td>
          <td>${escapeHtml(action.step ?? "")}</td>
          <td>${escapeHtml(action.action)}</td>
          <td>${label}</td>
          <td>${escapeHtml(action.detail ?? "")}</td>
        </tr>`;
  });

  const failureClass = record.failureScreenshot
    ? await embedder.classFor(record.failureScreenshot)
    : undefined;

  const softCount = record.actions.filter((a) => !a.ok && a.soft).length;
  const failCount = record.actions.filter((a) => !a.ok && !a.soft).length;

  // --- steps: the primary view ---
  const groups = groupIntoSteps(record.actions);
  const stepSections = await Promise.all(
    groups.map(async (group, index) => {
      const { cls, label } = stepOutcome(group);
      const heading = group.label ?? "Before the first step";
      const first = group.actions[0];
      const last = group.actions[group.actions.length - 1];
      // A step's clock starts when the previous one ended, so the first group is
      // measured from session start rather than from its own first action.
      const startedAt = index === 0 ? record.startedAt : groups[index - 1].actions.slice(-1)[0]?.timestamp;
      const elapsed = formatDuration(startedAt, last?.timestamp) ?? "—";

      const lines = await Promise.all(
        group.actions
          .filter((action) => action.action !== "ui_step")
          .map(async (action, i, visible) => {
            const shotPath =
              typeof action.args?.["path"] === "string" ? (action.args["path"] as string) : undefined;
            const shotClass = shotPath ? await embedder.classFor(shotPath) : undefined;
            const own = outcome(action);
            const since = formatDuration(
              i === 0 ? (first?.timestamp ?? startedAt) : visible[i - 1].timestamp,
              action.timestamp
            );
            return `
        <li class="${own.cls}">
          <span class="badge">${own.label}</span>
          <span class="what">${escapeHtml(describe(action))}</span>
          ${since ? `<span class="elapsed">+${since}</span>` : ""}
          ${action.detail && !action.ok ? `<div class="detail">${escapeHtml(action.detail)}</div>` : ""}
          ${shotClass ? `<div class="shot ${shotClass}"></div>` : ""}
        </li>`;
          })
      );

      return `
    <section class="step ${cls}">
      <h3>${escapeHtml(heading)} <span class="verdict">${label}</span> <span class="elapsed">${elapsed}</span></h3>
      ${lines.length > 0 ? `<ol class="actions">${lines.join("")}</ol>` : `<p class="note">No actions recorded for this step.</p>`}
    </section>`;
    })
  );

  const issues = record.issues ?? [];
  const issueSection =
    issues.length === 0
      ? ""
      : `
  <h2>Browser problems (${issues.length})</h2>
  <p class="note">Reported for information — these do not change the session verdict.</p>
  ${record.issuesTruncated ? `<p class="note">Only the first ${issues.length} were kept; later ones were dropped.</p>` : ""}
  <table>
    <thead><tr><th>Time</th><th>Kind</th><th>Message</th></tr></thead>
    <tbody>${issues
      .map(
        (issue) => `
      <tr class="issue"><td>${escapeHtml(issue.timestamp)}</td><td>${escapeHtml(issue.kind)}</td><td>${escapeHtml(issue.text)}</td></tr>`
      )
      .join("")}</tbody>
  </table>`;

  const duration = formatDuration(record.startedAt, record.endedAt) ?? "unknown";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Session report ${escapeHtml(record.id)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 60rem;
         padding: 2rem 1rem; color: #1f2328; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #d0d7de; padding: 0.4rem 0.6rem; text-align: left;
           vertical-align: top; font-size: 0.9rem; }
  tr.fail { background: #fde2e2; }
  tr.ok { background: #eafaf1; }
  tr.soft { background: #fff6e0; }
  tr.issue { background: #f6f8fa; }

  .verdict-box { border: 1px solid #d0d7de; border-left-width: 8px; border-radius: 6px;
                 padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
  .verdict-box.passed { border-left-color: #1a7f37; }
  .verdict-box.failed { border-left-color: #b91c1c; }
  .verdict-box h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
  .status-passed { color: #1a7f37; }
  .status-failed { color: #b91c1c; }
  .meta { color: #57606a; font-size: 0.9rem; margin: 0.15rem 0; }

  .step { border: 1px solid #d0d7de; border-radius: 6px; padding: 0.5rem 1rem 1rem;
          margin-bottom: 1rem; }
  .step.fail { border-color: #b91c1c; }
  .step h3 { margin: 0.5rem 0; font-size: 1.05rem; }
  .step .verdict { font-size: 0.75rem; padding: 0.1rem 0.45rem; border-radius: 999px;
                   background: #eaeef2; color: #57606a; vertical-align: middle; }
  .step.ok .verdict { background: #dafbe1; color: #1a7f37; }
  .step.fail .verdict { background: #ffebe9; color: #b91c1c; }
  .step.soft .verdict { background: #fff6e0; color: #8a6d3b; }

  ol.actions { list-style: none; padding: 0; margin: 0; }
  ol.actions li { padding: 0.35rem 0; border-top: 1px solid #eaeef2; }
  .badge { display: inline-block; min-width: 3.5rem; font-size: 0.7rem;
           font-weight: 600; letter-spacing: 0.03em; }
  li.ok .badge { color: #1a7f37; }
  li.fail .badge { color: #b91c1c; }
  li.soft .badge { color: #8a6d3b; }
  .what { font-family: ui-monospace, monospace; font-size: 0.85rem; }
  .elapsed { color: #8c959f; font-size: 0.8rem; }
  .detail { margin: 0.25rem 0 0 3.5rem; color: #b91c1c; font-size: 0.85rem; }
  .note { color: #8a6d3b; font-size: 0.9rem; }
  details { margin-top: 1.5rem; }
  summary { cursor: pointer; color: #57606a; }

  .shot { width: 320px; height: 200px; background-size: contain; margin: 0.4rem 0 0 3.5rem;
          background-repeat: no-repeat; background-position: top left;
          border: 1px solid #d0d7de; border-radius: 4px; }
  .shot.large { width: 480px; height: 300px; margin-left: 0; }
${embedder.styles()}
</style>
</head>
<body>
  <div class="verdict-box ${record.status}">
    <h1><span class="status-${record.status}">${record.status === "passed" ? "Passed" : record.status === "failed" ? "Failed" : escapeHtml(record.status)}</span></h1>
    <p class="meta"><strong>${escapeHtml(record.target)}</strong></p>
    <p class="meta">${groups.length} step(s) · ${record.actions.length} actions · ${failCount} failed · ${softCount} non-fatal check(s) false · ${issues.length} browser problem(s) · took ${duration}</p>
    <p class="meta">${escapeHtml(record.startedAt)} → ${escapeHtml(record.endedAt ?? "(never ended)")} · id ${escapeHtml(record.id)}</p>
    ${record.screenshotBudgetReached ? `<p class="note">Screenshot budget reached — further failure screenshots were not captured.</p>` : ""}
  </div>

  ${failureClass ? `<h2>Where it failed</h2><div class="shot large ${failureClass}"></div>` : ""}

  <h2>What happened</h2>
  ${stepSections.join("")}

  ${issueSection}

  <details>
    <summary>Raw action log (${record.actions.length})</summary>
    <table>
      <thead><tr><th>Time</th><th>Step</th><th>Action</th><th>Result</th><th>Detail</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </details>
</body>
</html>`;
}
