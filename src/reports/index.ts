// JSON + self-contained HTML report generation for a completed ui_session.
// T003 — see tasks/TASK_GUIDE_T003.md.

import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { LoggedAction, SessionRecord } from "../tools/session.js";

export interface ReportPaths {
  jsonPath: string;
  htmlPath: string;
}

/**
 * Write `record` to `reportsDir` as both a JSON report and a self-contained
 * HTML report (screenshots embedded as base64 data URIs). Writes go to a
 * temp file first and are then renamed into place, so a container restart
 * mid-write can never leave a corrupt/partial report at the final path
 * (Edge Case Checklist).
 */
export async function writeReports(record: SessionRecord, reportsDir: string): Promise<ReportPaths> {
  await mkdir(reportsDir, { recursive: true });

  const base = `session-${record.id}`;
  const jsonPath = path.join(reportsDir, `${base}.json`);
  const htmlPath = path.join(reportsDir, `${base}.html`);

  await atomicWrite(jsonPath, JSON.stringify(record, null, 2));
  await atomicWrite(htmlPath, await renderHtml(record));

  return { jsonPath, htmlPath };
}

async function atomicWrite(finalPath: string, contents: string): Promise<void> {
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, contents, "utf8");
  await rename(tmpPath, finalPath);
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
