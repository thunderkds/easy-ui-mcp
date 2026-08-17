// JSON + self-contained HTML report generation for a completed ui_session.
// T003 — see tasks/TASK_GUIDE_T003.md.

import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { SessionRecord } from "../tools/session.js";

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
function outcome(action: SessionRecord["actions"][number]): { cls: string; label: string } {
  if (action.ok) return { cls: "ok", label: "OK" };
  if (action.soft) return { cls: "soft", label: "CHECK" };
  return { cls: "fail", label: "FAIL" };
}

async function renderHtml(record: SessionRecord): Promise<string> {
  const embedder = new ScreenshotEmbedder();

  const rows = await Promise.all(
    record.actions.map(async (action) => {
      const screenshotPath =
        typeof action.args?.["path"] === "string" ? (action.args["path"] as string) : undefined;
      const shotClass = screenshotPath ? await embedder.classFor(screenshotPath) : undefined;
      const { cls, label } = outcome(action);
      return `
        <tr class="${cls}">
          <td>${escapeHtml(action.timestamp)}</td>
          <td>${escapeHtml(action.action)}</td>
          <td>${label}</td>
          <td>${escapeHtml(action.detail ?? "")}</td>
          <td>${shotClass ? `<div class="shot ${shotClass}"></div>` : ""}</td>
        </tr>`;
    })
  );

  const failureClass = record.failureScreenshot
    ? await embedder.classFor(record.failureScreenshot)
    : undefined;

  const softCount = record.actions.filter((a) => !a.ok && a.soft).length;
  const failCount = record.actions.filter((a) => !a.ok && !a.soft).length;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Session report ${escapeHtml(record.id)}</title>
<style>
  body { font-family: sans-serif; margin: 2rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #ccc; padding: 0.5rem; text-align: left; vertical-align: top; }
  tr.fail { background: #fde2e2; }
  tr.ok { background: #eafaf1; }
  tr.soft { background: #fff6e0; }
  .status-passed { color: #1a7f37; }
  .status-failed { color: #b91c1c; }
  .note { color: #8a6d3b; }
  .shot { width: 320px; height: 200px; background-size: contain;
          background-repeat: no-repeat; background-position: top left; }
  .shot.large { width: 480px; height: 300px; }
${embedder.styles()}
</style>
</head>
<body>
  <h1>Session report</h1>
  <p><strong>ID:</strong> ${escapeHtml(record.id)}</p>
  <p><strong>Target:</strong> ${escapeHtml(record.target)}</p>
  <p><strong>Status:</strong> <span class="status-${record.status}">${escapeHtml(record.status)}</span></p>
  <p><strong>Started:</strong> ${escapeHtml(record.startedAt)}</p>
  <p><strong>Ended:</strong> ${escapeHtml(record.endedAt ?? "")}</p>
  <p><strong>Outcomes:</strong> ${record.actions.length} actions, ${failCount} failed, ${softCount} non-fatal check(s) evaluated false</p>
  ${record.screenshotBudgetReached ? `<p class="note">Screenshot budget reached — further failure screenshots were not captured.</p>` : ""}
  ${failureClass ? `<h2>Failure screenshot</h2><div class="shot large ${failureClass}"></div>` : ""}
  <h2>Actions</h2>
  <table>
    <thead><tr><th>Time</th><th>Action</th><th>Result</th><th>Detail</th><th>Screenshot</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
</body>
</html>`;
}
