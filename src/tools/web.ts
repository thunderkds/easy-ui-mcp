// Primitive web-automation tools.
// T001: ui_navigate. T002: ui_click, ui_fill, ui_assert, ui_get_page_state, ui_take_screenshot.

import type { Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface NavigateResult {
  ok: boolean;
  url: string;
  title?: string;
  error?: string;
}

/**
 * Navigate the given Playwright page to `url` and report the outcome.
 * Never throws: unreachable/malformed URLs resolve to a clear `ok: false`
 * result instead of hanging or crashing the caller (Edge Case Checklist).
 */
export async function navigate(page: Page, url: string): Promise<NavigateResult> {
  try {
    await page.goto(url, { waitUntil: "load", timeout: 15_000 });
    return { ok: true, url: page.url(), title: await page.title() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, url, error: message };
  }
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Resolve `selector` against `page` and require exactly one match.
 * Returns the match count error (0 or >1) so callers can fail fast with
 * a message that names the selector (Edge Case Checklist).
 */
async function resolveUniqueLocator(
  page: Page,
  selector: string
): Promise<{ ok: true; locator: ReturnType<Page["locator"]> } | { ok: false; error: string }> {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count === 0) {
    return { ok: false, error: `No element matched selector "${selector}"` };
  }
  if (count > 1) {
    return {
      ok: false,
      error: `Selector "${selector}" matched ${count} elements; expected exactly 1`,
    };
  }
  return { ok: true, locator };
}

/**
 * Click the single element matching `selector`.
 * Fails clearly (no silent first-match click) if 0 or >1 elements match.
 */
export async function click(page: Page, selector: string): Promise<ActionResult> {
  const resolved = await resolveUniqueLocator(page, selector);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    await resolved.locator.click({ timeout: 5_000 });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Fill the single input element matching `selector` with `value`.
 * Same 0/>1-match error handling as `click`.
 */
export async function fill(page: Page, selector: string, value: string): Promise<ActionResult> {
  const resolved = await resolveUniqueLocator(page, selector);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    await resolved.locator.fill(value, { timeout: 5_000 });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export interface AssertResult {
  ok: boolean;
  passed?: boolean;
  error?: string;
}

/**
 * Evaluate `condition` (a JS expression string) against the current page
 * and report pass/fail. `ok: false` means the assertion itself could not
 * run (e.g. no active page, or the expression threw) — distinct from
 * `passed: false`, which means it ran and evaluated falsy.
 */
export async function assertCondition(
  page: Page | undefined,
  condition: string
): Promise<AssertResult> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  try {
    const result = await page.evaluate(condition);
    return { ok: true, passed: Boolean(result) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Translate an `assertCondition` result into how ui_check should record it.
 *
 * This is the whole soft/hard decision for FR-014, kept out of server.ts's
 * per-connection closure so it can be unit-tested: a condition that *ran* and
 * came back falsy is soft, while one that could not run is a harness error and
 * stays hard, exactly like ui_assert.
 */
export function classifyCheckOutcome(result: AssertResult): {
  ok: boolean;
  detail?: string;
  soft: boolean;
} {
  if (!result.ok) return { ok: false, detail: result.error, soft: false };
  if (result.passed) return { ok: true, soft: false };
  return { ok: false, detail: "Check evaluated false", soft: true };
}

/** Upper bound on a single wait, so a wait can never outlive its session
 * (SESSION_TIMEOUT_MS) and leave the poll loop running against a closed page. */
export const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 100;

export interface WaitResult {
  ok: boolean;
  elapsedMs?: number;
  error?: string;
}

/**
 * Poll `condition` until it holds or `timeoutMs` elapses. Unlike ui_check this is
 * a hard outcome: not becoming true is a failure, because the caller asserted it
 * eventually would (FR-015).
 *
 * An expression that *throws* fails immediately rather than being retried — a
 * ReferenceError will not fix itself, and retrying it just delays a clear error
 * by the full timeout.
 */
export async function waitForCondition(
  page: Page | undefined,
  condition: string,
  timeoutMs: number
): Promise<WaitResult> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, error: "timeoutMs must be a positive number" };
  }

  const budget = Math.min(timeoutMs, MAX_WAIT_MS);
  const startedAt = Date.now();

  for (;;) {
    try {
      if (await page.evaluate(condition)) {
        return { ok: true, elapsedMs: Date.now() - startedAt };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, elapsedMs: Date.now() - startedAt, error: message };
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= budget) {
      return {
        ok: false,
        elapsedMs: elapsed,
        error: `Timed out after ${elapsed}ms waiting for: ${condition}`,
      };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(POLL_INTERVAL_MS, budget - elapsed))
    );
  }
}

export interface PageElement {
  role: string;
  name: string;
}

export interface PageState {
  ok: boolean;
  url?: string;
  title?: string;
  elements?: PageElement[];
  error?: string;
}

const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"]';

/**
 * Return structured page state (URL, title, visible interactive elements)
 * an agent can reason over to decide its next action. Walks visible
 * interactive elements and derives an accessible role/name for each —
 * cheaper for the calling agent to reason over than a raw HTML dump
 * (per BRAINSTORMING_LOG.md).
 */
export async function getPageState(page: Page | undefined): Promise<PageState> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  try {
    const elements = await page.$$eval(INTERACTIVE_SELECTOR, (nodes) =>
      nodes
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((el) => {
          const explicitRole = el.getAttribute("role");
          const tag = el.tagName.toLowerCase();
          const role =
            explicitRole ??
            (tag === "a"
              ? "link"
              : tag === "button"
                ? "button"
                : tag === "input" || tag === "textarea"
                  ? "textbox"
                  : tag === "select"
                    ? "combobox"
                    : tag);
          const name =
            el.getAttribute("aria-label") ??
            (el as HTMLElement).innerText?.trim() ??
            (el as HTMLInputElement).placeholder ??
            (el as HTMLInputElement).value ??
            "";
          return { role, name };
        })
        .filter((e) => e.name.length > 0)
    );
    return { ok: true, url: page.url(), title: await page.title(), elements };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export interface ScreenshotResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Capture the current viewport and write it as a PNG under `outputDir`.
 * Write failures (disk full, permissions) return a clear error instead of
 * crashing the session (Edge Case Checklist).
 */
export async function takeScreenshot(
  page: Page | undefined,
  outputDir: string
): Promise<ScreenshotResult> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  try {
    await mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `screenshot-${Date.now()}.png`);
    await page.screenshot({ path: filePath });
    return { ok: true, path: filePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
