// JSON + self-contained HTML report generation for a completed ui_session.
// T003 — see tasks/TASK_GUIDE_T003.md.

import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
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

async function toBase64Image(filePath: string): Promise<string | undefined> {
  try {
    const data = await readFile(filePath);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    // Screenshot file missing/unreadable — omit it rather than failing the report.
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function renderHtml(record: SessionRecord): Promise<string> {
  const rows = await Promise.all(
    record.actions.map(async (action) => {
      const screenshotPath =
        typeof action.args?.["path"] === "string" ? (action.args["path"] as string) : undefined;
      const screenshot = screenshotPath ? await toBase64Image(screenshotPath) : undefined;
      return `
        <tr class="${action.ok ? "ok" : "fail"}">
          <td>${escapeHtml(action.timestamp)}</td>
          <td>${escapeHtml(action.action)}</td>
          <td>${action.ok ? "OK" : "FAIL"}</td>
          <td>${escapeHtml(action.detail ?? "")}</td>
          <td>${screenshot ? `<img src="${screenshot}" width="320" />` : ""}</td>
        </tr>`;
    })
  );

  const failureScreenshot = record.failureScreenshot
    ? await toBase64Image(record.failureScreenshot)
    : undefined;

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
  .status-passed { color: #1a7f37; }
  .status-failed { color: #b91c1c; }
</style>
</head>
<body>
  <h1>Session report</h1>
  <p><strong>ID:</strong> ${escapeHtml(record.id)}</p>
  <p><strong>Target:</strong> ${escapeHtml(record.target)}</p>
  <p><strong>Status:</strong> <span class="status-${record.status}">${escapeHtml(record.status)}</span></p>
  <p><strong>Started:</strong> ${escapeHtml(record.startedAt)}</p>
  <p><strong>Ended:</strong> ${escapeHtml(record.endedAt ?? "")}</p>
  ${failureScreenshot ? `<h2>Failure screenshot</h2><img src="${failureScreenshot}" width="480" />` : ""}
  <h2>Actions</h2>
  <table>
    <thead><tr><th>Time</th><th>Action</th><th>Result</th><th>Detail</th><th>Screenshot</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
</body>
</html>`;
}
