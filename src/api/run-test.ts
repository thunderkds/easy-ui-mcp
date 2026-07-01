// REST wrapper for non-MCP callers (T004) — see tasks/TASK_GUIDE_T004.md.
//
// Per the Critical Constraint (no server-side LLM calls), this endpoint does
// NOT interpret `flow_description` into arbitrary browser steps — there is no
// NL-to-action interpreter in this project (Option A architecture). Instead
// it runs the thin "single-navigate-and-screenshot" smoke check explicitly
// permitted by the task guide's Out of Scope note: it navigates to
// `app_url_or_package` and captures a screenshot, using `flow_description`
// only as a human-readable label recorded on the session/report. Callers
// that need multi-step flows still drive the MCP primitive tools directly.

import type { Request, Response } from "express";
import path from "node:path";
import {
  startSession,
  endSession,
  getSessionPage,
  logAction,
  markFailed,
  type LoggedAction,
} from "../tools/session.js";
import { navigate, takeScreenshot } from "../tools/web.js";
import { writeReports } from "../reports/index.js";

const REPORTS_DIR = path.join(process.cwd(), "reports");
const DEFAULT_TIMEOUT_MS = 30_000;

function nowIso(): string {
  return new Date().toISOString();
}

export async function handleRunTest(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { platform, flow_description: flowDescription, app_url_or_package: target, timeout } = body;

  if (typeof target !== "string" || target.trim() === "") {
    res.status(400).json({ error: "app_url_or_package is required and must be a non-empty string" });
    return;
  }
  if (platform !== undefined && platform !== "web") {
    res.status(400).json({ error: `Unsupported platform "${String(platform)}" — only "web" is supported in v1` });
    return;
  }
  if (timeout !== undefined && (typeof timeout !== "number" || timeout <= 0)) {
    res.status(400).json({ error: "timeout must be a positive number of milliseconds" });
    return;
  }

  const timeoutMs = typeof timeout === "number" ? timeout : DEFAULT_TIMEOUT_MS;
  const label = typeof flowDescription === "string" && flowDescription.trim() !== "" ? flowDescription : target;

  const { id: sessionId } = await startSession(label, timeoutMs);

  let timedOut = false;
  const timeoutPromise = new Promise<void>((resolve) => {
    const handle = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
    handle.unref?.();
  });

  const runPromise = (async () => {
    const page = getSessionPage(sessionId);
    if (!page) return;

    const navResult = await navigate(page, target);
    const navAction: LoggedAction = {
      timestamp: nowIso(),
      action: "ui_navigate",
      args: { url: target },
      ok: navResult.ok,
      detail: navResult.ok ? navResult.url : navResult.error,
    };
    logAction(sessionId, navAction);
    if (!navResult.ok) {
      const shot = await takeScreenshot(page, REPORTS_DIR);
      markFailed(sessionId, shot.ok ? shot.path : undefined);
      return;
    }

    const shot = await takeScreenshot(page, REPORTS_DIR);
    logAction(sessionId, {
      timestamp: nowIso(),
      action: "ui_take_screenshot",
      args: shot.ok ? { path: shot.path } : undefined,
      ok: shot.ok,
      detail: shot.ok ? undefined : shot.error,
    });
    if (!shot.ok) markFailed(sessionId);
  })();

  await Promise.race([runPromise, timeoutPromise]);
  if (timedOut) markFailed(sessionId);

  const record = await endSession(sessionId);
  if (!record) {
    res.status(500).json({ error: "Session ended unexpectedly" });
    return;
  }

  const { jsonPath, htmlPath } = await writeReports(record, REPORTS_DIR);
  void jsonPath;

  const screenshots = record.actions
    .filter((a) => a.action === "ui_take_screenshot" && a.ok)
    .map((a) => a.args?.["path"])
    .filter((p): p is string => typeof p === "string");

  res.status(200).json({
    status: timedOut ? "timeout" : record.status,
    report_url: htmlPath,
    screenshots,
    logs: record.actions,
  });
}
