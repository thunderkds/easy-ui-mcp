// Primitive web-automation tools.
// T001: ui_navigate. T002: ui_click, ui_fill, ui_assert, ui_get_page_state, ui_take_screenshot.

import type { Page } from "playwright";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** Optional ways to click (T031). All absent = a plain left click on the element's centre. */
export interface ClickOptions {
  button?: "left" | "right" | "middle";
  /** 1 (default), 2 = double-click, 3 = triple-click. */
  clickCount?: number;
  modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift" | "ControlOrMeta">;
  /** Offset from the element's top-left corner, in CSS pixels. */
  position?: { x: number; y: number };
  /** Skip Playwright's actionability checks (e.g. click through a transparent overlay). */
  force?: boolean;
}

/**
 * Click the single element matching `selector`, optionally as a right/middle/double/
 * modifier click, at an offset, or forced.
 * Fails clearly (no silent first-match click) if 0 or >1 elements match.
 */
export async function click(
  page: Page,
  selector: string,
  options: ClickOptions = {}
): Promise<ActionResult> {
  const resolved = await resolveUniqueLocator(page, selector);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { button, clickCount, modifiers, position, force } = options;
  try {
    await resolved.locator.click({
      timeout: 5_000,
      ...(button && { button }),
      ...(clickCount && { clickCount }),
      ...(modifiers?.length && { modifiers }),
      ...(position && { position }),
      ...(force && { force }),
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * One sentence for a click, shared by the tool's reply and the report so the two
 * never disagree: `Right-clicked X`, `Double-clicked X`, `Clicked X (forced)`,
 * `Clicked X with Shift at 4,4`. `target` is already formatted (quoted or not) by the caller.
 */
export function describeClick(target: string, options: ClickOptions = {}): string {
  const count = options.clickCount === 2 ? "Double" : options.clickCount === 3 ? "Triple" : undefined;
  const button = options.button === "right" || options.button === "middle" ? options.button : undefined;
  let verb = "Clicked";
  if (count && button) verb = `${count} ${button}-clicked`;
  else if (count) verb = `${count}-clicked`;
  else if (button) verb = `${button[0].toUpperCase()}${button.slice(1)}-clicked`;
  let text = `${verb} ${target}`;
  if (Array.isArray(options.modifiers) && options.modifiers.length > 0) {
    text += ` with ${options.modifiers.join("+")}`;
  }
  const pos = options.position;
  if (pos && typeof pos.x === "number" && typeof pos.y === "number") text += ` at ${pos.x},${pos.y}`;
  if (options.force === true) text += " (forced)";
  return text;
}

export interface ClickOutsideResult extends ActionResult {
  /** What the click landed on, e.g. `div#backdrop` or `dialog#d (::backdrop)`. */
  hit?: string;
  x?: number;
  y?: number;
}

/**
 * Click a viewport point just outside the single element matching `selector` — how a
 * user dismisses a modal, drawer or popover by clicking its backdrop. Candidates are
 * the centres of the four viewport margins around the element, then the viewport
 * corners; the first whose topmost element is outside the target and is not an
 * interactive control wins, so a control is never clicked by accident. A modal
 * `<dialog>`'s `::backdrop` reports the dialog itself as the topmost element, which
 * is accepted for a point outside the dialog's box.
 */
export async function clickOutside(page: Page, selector: string): Promise<ClickOutsideResult> {
  const resolved = await resolveUniqueLocator(page, selector);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    const found = await resolved.locator.evaluate((el) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const r = el.getBoundingClientRect();
      const midY = Math.min(Math.max((Math.max(r.top, 0) + Math.min(r.bottom, H)) / 2, 1), H - 2);
      const midX = Math.min(Math.max((Math.max(r.left, 0) + Math.min(r.right, W)) / 2, 1), W - 2);
      const MIN = 4;
      const points: Array<[number, number]> = [];
      if (r.left >= MIN) points.push([r.left / 2, midY]);
      if (W - r.right >= MIN) points.push([(r.right + W) / 2, midY]);
      if (r.top >= MIN) points.push([midX, r.top / 2]);
      if (H - r.bottom >= MIN) points.push([midX, (r.bottom + H) / 2]);
      points.push([2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]);
      const interactive =
        'a[href],button,input,select,textarea,summary,label,iframe,video,audio,[contenteditable=""],[contenteditable="true"],' +
        '[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"]';
      // No named helper inside: tsx injects `__name(...)` around one, which does not exist in the page.
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) continue;
        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        const onBackdrop = top === el && el.tagName === "DIALOG" && el.matches(":modal");
        if (!onBackdrop && el.contains(top)) continue;
        if (top.closest(interactive)) continue;
        const cls = typeof top.className === "string" ? top.className.trim().split(/\s+/)[0] : "";
        const label = top.tagName.toLowerCase() + (top.id ? `#${top.id}` : "") + (cls ? `.${cls}` : "");
        return { x, y, hit: onBackdrop ? `${label} (::backdrop)` : label };
      }
      return null;
    });
    if (!found) {
      return {
        ok: false,
        error: `No safe point outside "${selector}" to click (it covers the viewport, or every point around it is an interactive control). Try ui_press_key with Escape instead.`,
      };
    }
    await page.mouse.click(found.x, found.y);
    return { ok: true, hit: found.hit, x: Math.round(found.x), y: Math.round(found.y) };
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

/**
 * T019 shared shape: require exactly one match for `selector`, run `act` on it,
 * and turn any Playwright failure into `{ ok: false, error }` — never throws.
 */
async function onUniqueLocator(
  page: Page,
  selector: string,
  act: (locator: ReturnType<Page["locator"]>) => Promise<ActionResult | void>
): Promise<ActionResult> {
  const resolved = await resolveUniqueLocator(page, selector);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    return (await act(resolved.locator)) ?? { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Choose the option of the single `<select>` matching `selector` whose value or
 * visible label equals `value`. A `<select multiple>` ends with exactly that one
 * option selected. An unknown option fails fast and lists what exists.
 */
export async function selectOption(
  page: Page,
  selector: string,
  value: string
): Promise<ActionResult> {
  return onUniqueLocator(page, selector, async (locator) => {
    // [tag, [value, label][]] — read in one round trip so the failure can name the choices.
    const info = await locator.evaluate((el) => [
      el.tagName,
      Array.from((el as HTMLSelectElement).options ?? []).map((o) => [o.value, o.label.trim()]),
    ]);
    const [tag, options] = info as [string, [string, string][]];
    if (tag !== "SELECT") {
      return { ok: false, error: `Element matched by "${selector}" is not a <select> (it is <${tag.toLowerCase()}>)` };
    }
    if (!options.some(([v, l]) => v === value || l === value)) {
      const labels = options.map(([v, l]) => `"${l || v}"`).join(", ");
      return { ok: false, error: `No option "${value}" in "${selector}"; available: ${labels || "(none)"}` };
    }
    await locator.selectOption(value, { timeout: 5_000 });
  });
}

/**
 * Press a Playwright key name (`Enter`, `Tab`, `Escape`, `ArrowDown`, `Control+a`…).
 * With `selector`, presses on that single element (focusing it first); without,
 * presses on whatever has focus — the page body when nothing does. An unknown key
 * name fails with Playwright's `Unknown key` error.
 */
export async function pressKey(page: Page, key: string, selector?: string): Promise<ActionResult> {
  if (selector === undefined) {
    try {
      await page.keyboard.press(key);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
  return onUniqueLocator(page, selector, async (locator) => {
    await locator.press(key, { timeout: 5_000 });
  });
}

/** Move the pointer over the single element matching `selector` (reveals :hover / mouseenter content). */
export async function hover(page: Page, selector: string): Promise<ActionResult> {
  return onUniqueLocator(page, selector, async (locator) => {
    await locator.hover({ timeout: 5_000 });
  });
}

/**
 * Put the single checkbox/radio matching `selector` into the `checked` state.
 * Idempotent: already in that state is a successful no-op. Playwright rejects a
 * non-checkbox and unchecking a radio, and that message is passed through.
 */
export async function setChecked(
  page: Page,
  selector: string,
  checked: boolean
): Promise<ActionResult> {
  return onUniqueLocator(page, selector, async (locator) => {
    await locator.setChecked(checked, { timeout: 5_000 });
  });
}

/** Result with a sentence for the agent (T032): what happened, beyond ok/error. */
export interface MessageResult extends ActionResult {
  message?: string;
}

/** Allowed `ui_set_viewport` / session `viewport` range (T032 AC3). */
export const MIN_VIEWPORT_WIDTH = 320;
export const MAX_VIEWPORT_WIDTH = 3840;
export const MIN_VIEWPORT_HEIGHT = 320;
export const MAX_VIEWPORT_HEIGHT = 2160;

/**
 * Resize the current page's viewport. Selectors from an earlier `ui_get_page_state`
 * may point at different elements after a resize (responsive layouts), so the
 * message says to read the state again.
 */
export async function setViewport(page: Page, width: number, height: number): Promise<MessageResult> {
  const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (
    !inRange(width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH) ||
    !inRange(height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT)
  ) {
    return {
      ok: false,
      error: `Viewport must be whole pixels, ${MIN_VIEWPORT_WIDTH}-${MAX_VIEWPORT_WIDTH} wide and ${MIN_VIEWPORT_HEIGHT}-${MAX_VIEWPORT_HEIGHT} high (got ${width}x${height})`,
    };
  }
  try {
    await page.setViewportSize({ width, height });
    return {
      ok: true,
      message: `Viewport set to ${width}x${height}. The layout may have changed: call ui_get_page_state again (selectors containing "nth=" may be stale).`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Longest per-keystroke pause `ui_type` accepts. */
export const MAX_TYPE_DELAY_MS = 500;

export interface TypeResult extends ActionResult {
  /** True unless the target was positively a non-secret field: the caller must then
   * keep the typed text out of the report (a password, one-time-code, card-number or
   * text-security field, or a target we could not check). */
  masked: boolean;
}

/**
 * Type `text` into the single editable element matching `selector`, one key at a time
 * (`keydown`/`input`/`keyup` per character), appending to what is already there.
 * Unlike `fill` this triggers autocomplete, masked inputs and OTP boxes.
 */
export async function typeText(
  page: Page,
  selector: string,
  text: string,
  delayMs: number = 0
): Promise<TypeResult> {
  let masked = true;
  const result = await onUniqueLocator(page, selector, async (locator) => {
    masked = (await locator.evaluate((el) => {
      const input = el as HTMLInputElement;
      const autocomplete = (input.getAttribute("autocomplete") ?? "").toLowerCase();
      return (
        input.type === "password" ||
        autocomplete.includes("one-time-code") ||
        autocomplete.includes("cc-") ||
        autocomplete.includes("password") ||
        !["", "none"].includes(getComputedStyle(el).getPropertyValue("-webkit-text-security"))
      );
    })) as boolean;
    // Throws for a non-input element such as a <div>; false for a disabled or read-only one.
    if (!(await locator.isEditable({ timeout: 5_000 }))) {
      return { ok: false, error: `Element matched by "${selector}" is not editable (disabled or read-only)` };
    }
    await locator.pressSequentially(text, { delay: delayMs, timeout: 5_000 + text.length * delayMs });
  });
  return { ...result, masked };
}

/**
 * Go back, forward or reload on the current page. Chromium keeps the initial blank
 * page as history entry 0, so "back" from the first real page would land on
 * about:blank; that, and a missing forward entry, are reported instead of followed.
 */
export async function navigateHistory(
  page: Page,
  action: "back" | "forward" | "reload"
): Promise<NavigateResult> {
  try {
    if (action !== "reload") {
      const cdp = await page.context().newCDPSession(page);
      let history: { currentIndex: number; entries: { url: string }[] };
      try {
        history = await cdp.send("Page.getNavigationHistory");
      } finally {
        await cdp.detach().catch(() => undefined);
      }
      const target = history.entries[history.currentIndex + (action === "back" ? -1 : 1)];
      const initialBlank = action === "back" && history.currentIndex === 1 && target?.url === "about:blank";
      if (!target || initialBlank) {
        return {
          ok: false,
          url: page.url(),
          error: `No ${action === "back" ? "earlier" : "later"} history entry: cannot go ${action} from ${page.url()}`,
        };
      }
    }
    const options = { waitUntil: "load", timeout: 15_000 } as const;
    if (action === "back") await page.goBack(options);
    else if (action === "forward") await page.goForward(options);
    else await page.reload(options);
    return { ok: true, url: page.url(), title: await page.title() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, url: page.url(), error: message };
  }
}

export type ScrollDirection = "down" | "up" | "left" | "right" | "top" | "bottom";

export interface ScrollResult extends MessageResult {
  /** False when the scroll position did not change (already at that edge, or nothing to scroll). */
  moved?: boolean;
  /** True when, after this call, the area is at the edge in `direction`: stop looping. */
  atEnd?: boolean;
}

/**
 * Scroll one step. Three modes:
 *  - `selector`: bring that element into view (`container` / `direction` do not apply);
 *  - `container`: scroll that element by one of its own heights (or widths) in `direction`;
 *  - neither: scroll the page by one viewport in `direction` (default down).
 * `top` / `bottom` jump to that edge. The result says whether anything moved and whether
 * the edge was reached, so a lazy-list loop knows when to stop. A scroll area with
 * nothing to scroll is not an error.
 */
export async function scroll(
  page: Page,
  selector?: string,
  options: { container?: string; direction?: ScrollDirection } = {}
): Promise<ScrollResult> {
  const { container, direction = "down" } = options;
  if (selector !== undefined) {
    if (container !== undefined || options.direction !== undefined) {
      return { ok: false, error: "selector scrolls an element into view; do not combine it with container or direction" };
    }
    return onUniqueLocator(page, selector, async (locator) => {
      await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
    });
  }
  // The page itself scrolls through the document element (its scrollingElement).
  const area = container === undefined ? "the page" : `"${container}"`;
  const outcome = await onUniqueLocator(page, container ?? "html", async (locator) => {
    // NOTE: no named inner functions here: tsx/esbuild adds a `__name` helper the browser lacks.
    // `behavior: "instant"` overrides CSS `scroll-behavior: smooth`, which would otherwise
    // leave the position unchanged when we read it back.
    const read = (await locator.evaluate((el, dir) => {
      const t = el === document.documentElement ? document.scrollingElement || el : el;
      const vertical = dir === "down" || dir === "up" || dir === "top" || dir === "bottom";
      const before = vertical ? t.scrollTop : t.scrollLeft;
      const size = vertical ? t.clientHeight : t.clientWidth;
      const max = (vertical ? t.scrollHeight - t.clientHeight : t.scrollWidth - t.clientWidth);
      const to =
        dir === "down" || dir === "right" ? before + size : dir === "up" || dir === "left" ? before - size : dir === "top" ? 0 : max;
      t.scrollTo(vertical ? { top: to, behavior: "instant" } : { left: to, behavior: "instant" });
      const after = vertical ? t.scrollTop : t.scrollLeft;
      const towardStart = dir === "up" || dir === "left" || dir === "top";
      return { moved: after !== before, atEnd: towardStart ? after <= 0 : after >= max - 1, scrollable: max > 0 };
    }, direction)) as { moved: boolean; atEnd: boolean; scrollable: boolean };
    const edge = { down: "bottom", up: "top", top: "top", bottom: "bottom", left: "left edge", right: "right edge" }[direction];
    const message = !read.scrollable
      ? `Nothing to scroll: ${area} does not overflow ${direction === "left" || direction === "right" ? "horizontally" : "vertically"} (end reached)`
      : !read.moved
        ? `Did not move: ${area} is already at the ${edge} (end reached)`
        : read.atEnd
          ? `Scrolled ${area} ${direction}; reached the ${edge} (end reached)`
          : `Scrolled ${area} ${direction} one step`;
    return { ok: true, moved: read.moved, atEnd: read.atEnd, message } as ScrollResult;
  });
  return outcome as ScrollResult;
}

/**
 * The one file ui_upload_file ever sends (decision D1): a server constant resolved
 * from the app folder — never built from tool input — so the agent cannot upload any
 * other container file to the site under test. Same location from src/ and dist/.
 */
export const UPLOAD_FILE_NAME = "default_draft.png";
const UPLOAD_FILE_PATH = fileURLToPath(new URL(`../../assets/${UPLOAD_FILE_NAME}`, import.meta.url));

/** Size of the built-in upload file in bytes, or undefined if it is missing from the install. */
export async function getUploadFileSize(): Promise<number | undefined> {
  try {
    return (await stat(UPLOAD_FILE_PATH)).size;
  } catch {
    return undefined;
  }
}

/** True when an `accept` attribute lets a PNG through (an absent/empty one accepts anything). */
function acceptsPng(accept: string | null): boolean {
  const tokens = (accept ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => t !== "");
  return tokens.length === 0 || tokens.some((t) => ["image/png", "image/*", ".png", "*/*"].includes(t));
}

/**
 * True when clicking `selector` may open a tab or start a download: the element is, or sits
 * inside, a link with target/download, a button, or a submit control. Only those clicks are
 * worth waiting a moment for; others return at once (a missed event is still announced on the next response).
 */
export async function mayOpenTabOrDownload(page: Page, selector: string): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => !!el.closest("a[target], a[download], button, input[type=submit], input[type=button], input[type=image]"), undefined, { timeout: 1_000 })
    .catch(() => false);
}

export interface UploadResult extends ActionResult {
  file?: string;
  size?: number;
  /** Set when the input's `accept` excludes images, so the app may reject the file. */
  warning?: string;
}

/**
 * Upload the built-in default_draft.png through the single element matching
 * `selector`: an `input[type=file]` directly (hidden ones included), or any element
 * whose click opens a file chooser (a styled "Upload" button over a hidden input).
 * Takes no path on purpose (D1).
 */
export async function uploadFile(page: Page, selector: string): Promise<UploadResult> {
  const size = await getUploadFileSize();
  if (size === undefined) {
    return { ok: false, error: `Built-in upload file ${UPLOAD_FILE_NAME} is missing from the server` };
  }
  let accept: string | null = null;
  const result = await onUniqueLocator(page, selector, async (locator) => {
    const isFileInput = await locator.evaluate((el) => el instanceof HTMLInputElement && el.type === "file");
    if (isFileInput) {
      accept = await locator.getAttribute("accept");
      await locator.setInputFiles(UPLOAD_FILE_PATH, { timeout: 5_000 });
      return;
    }
    const opened = page.waitForEvent("filechooser", { timeout: 5_000 });
    opened.catch(() => undefined); // a failing click below must not leave this rejection unhandled
    await locator.click({ timeout: 5_000 });
    const chooser = await opened.catch(() => undefined);
    if (!chooser) {
      return { ok: false, error: `Clicking "${selector}" did not open a file chooser; pass the file input or the button that opens it` };
    }
    accept = await chooser.element().getAttribute("accept");
    await chooser.setFiles(UPLOAD_FILE_PATH);
  });
  if (!result.ok) return result;
  return {
    ok: true,
    file: UPLOAD_FILE_NAME,
    size,
    ...(acceptsPng(accept) ? {} : { warning: `the input's accept="${accept}" excludes images, so the app may reject ${UPLOAD_FILE_NAME}` }),
  };
}

/**
 * Drag the single `from` match onto the single `to` match (Playwright `dragTo`:
 * real pointer events, so it drives both HTML5 drag-and-drop and pointer-based sortables).
 */
export async function drag(page: Page, from: string, to: string): Promise<ActionResult> {
  return onUniqueLocator(page, from, async (source) => {
    const target = await resolveUniqueLocator(page, to);
    if (!target.ok) return { ok: false, error: target.error };
    await source.dragTo(target.locator, { timeout: 5_000 });
  });
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

/** Only the non-default fields are present; the whole object is omitted when empty. */
export interface PageElementState {
  disabled?: true;
  checked?: boolean | "mixed";
  /** Inputs, textarea, select and aria-valuenow widgets; capped at 100 chars; never `type=password`. */
  value?: string;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean | "mixed";
  required?: true;
  invalid?: true;
}

export interface PageElement {
  role: string;
  name: string;
  /** Pass unchanged to ui_click / ui_fill; resolves to exactly this element. */
  selector: string;
  state?: PageElementState;
}

/** A visible dialog; `selector` follows the same staleness note as `PageElement.selector`. */
export interface PageOverlay {
  role: string;
  name: string;
  selector: string;
  modal: boolean;
}

export interface PageFocus {
  role: string;
  name: string;
  selector: string;
}

export interface PageState {
  ok: boolean;
  url?: string;
  title?: string;
  elements?: PageElement[];
  /** Visible dialogs, topmost first. Omitted when none is open. */
  overlays?: PageOverlay[];
  /** The element holding focus. Omitted when focus is on the body, in an iframe, or in a shadow root. */
  focused?: PageFocus;
  messages?: string[];
  /** Set when `elements` was capped at MAX_PAGE_ELEMENTS. */
  note?: string;
  error?: string;
}

/** Bounds `ui_get_page_state` output (and selector-verification cost) on huge pages. */
const MAX_PAGE_ELEMENTS = 200;

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  ...[
    "button",
    "link",
    "checkbox",
    "radio",
    "tab",
    "menuitem",
    "combobox",
    "listbox",
    "option",
    "switch",
    "menuitemcheckbox",
    "menuitemradio",
    "treeitem",
    "slider",
    "spinbutton",
    "searchbox",
    "textbox",
  ].map((role) => `[role="${role}"]`),
  // Focusable custom widgets with some other role; role-less tabindex divs are layout noise.
  '[role][tabindex]:not([tabindex^="-"])',
].join(", ");

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]';

const MESSAGE_SELECTOR = '[role="alert"], [role="status"], [aria-live]:not([aria-live="off"])';

/** CSS.escape (CSSOM spec), for building `#id` selectors in Node. */
function cssEscapeIdent(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if (code === 0) out += "�";
    else if (
      (code >= 0x1 && code <= 0x1f) ||
      code === 0x7f ||
      (i === 0 && code >= 0x30 && code <= 0x39) ||
      (i === 1 && code >= 0x30 && code <= 0x39 && value.charCodeAt(0) === 0x2d)
    ) {
      out += `\\${code.toString(16)} `;
    } else if (i === 0 && value.length === 1 && code === 0x2d) out += `\\${ch}`;
    else if (
      code >= 0x80 ||
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    ) {
      out += ch;
    } else out += `\\${ch}`;
  }
  return out;
}

/** Escape for use inside a double-quoted string in a CSS attribute or role selector. */
function quoteSelectorString(value: string): string {
  return `"${value
    .replace(/[\\"]/g, "\\$&")
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ")}"`;
}

interface RawElement {
  index: number; // position in INTERACTIVE_SELECTOR (or OVERLAY_SELECTOR) document order
  role: string;
  name: string;
  testId: string;
  id: string;
  /** aria-label of a contenteditable element (Playwright's role=textbox does not match those). */
  editableLabel?: string;
  /** A <summary>: Playwright gives it no role, so `role=button[name=…]` never matches it. */
  isSummary?: boolean;
}

/** What the in-page pass returns per element; `state` is null when every field is default. */
interface RawPageElement extends RawElement {
  visible: boolean;
  state: PageElementState | null;
}

/** Roles that are reported elsewhere (`messages`, `overlays`), not as `elements`. */
const NON_ELEMENT_ROLES = ["alert", "status", "dialog", "alertdialog"];

type ElementHandle = NonNullable<Awaited<ReturnType<Page["$"]>>>;

/**
 * Where `target` sits among the matches of `selector`: `{count, position}` with
 * position -1 if absent. A selector that fails to parse counts as matching nothing.
 */
async function locate(
  page: Page,
  selector: string,
  target: ElementHandle
): Promise<{ count: number; position: number }> {
  try {
    return await page
      .locator(selector)
      .evaluateAll((els, t) => ({ count: els.length, position: els.indexOf(t as HTMLElement) }), target);
  } catch {
    return { count: 0, position: -1 };
  }
}

/**
 * Pick the first selector (data-testid > #id > role+name > role+name >> nth) that
 * resolves to exactly `target` and nothing else. Every candidate is checked against
 * the live page by element identity, so a quoting/escaping mistake or hostile page
 * content can only cause a fall-through, never a selector that hits another element.
 * Returns undefined if nothing verifies (element vanished); caller drops it.
 */
async function buildSelector(
  page: Page,
  raw: RawElement,
  handles: ElementHandle[],
  sharedRoleMatches: Map<string, number[]>,
  positionalBase: string = INTERACTIVE_SELECTOR
): Promise<string | undefined> {
  const target = handles[raw.index];
  const isOnlyTarget = async (selector: string) => {
    const hit = await locate(page, selector, target);
    return hit.count === 1 && hit.position === 0;
  };

  if (raw.testId) {
    const candidate = `[data-testid=${quoteSelectorString(raw.testId)}]`;
    if (await isOnlyTarget(candidate)) return candidate;
  }
  if (raw.id) {
    const candidate = `#${cssEscapeIdent(raw.id)}`;
    if (await isOnlyTarget(candidate)) return candidate;
  }
  if (raw.editableLabel) {
    const candidate = `[contenteditable][aria-label=${quoteSelectorString(raw.editableLabel)}]`;
    if (await isOnlyTarget(candidate)) return candidate;
  }
  if (raw.isSummary && raw.name) {
    const candidate = `summary:text-is(${quoteSelectorString(raw.name)})`;
    if (await isOnlyTarget(candidate)) return candidate;
  }
  // The role comes from a page attribute; only plain tokens are put in a selector.
  if (/^[a-z][a-z0-9-]*$/i.test(raw.role)) {
    const candidate = `role=${raw.role}[name=${quoteSelectorString(raw.name)}]`;
    // Elements sharing a role+name (e.g. 500 identical buttons) are resolved with one
    // page round-trip: `shared` maps every interactive element to its position in
    // this candidate's matches (-1 if absent), and is reused by the later ones.
    let shared = sharedRoleMatches.get(candidate);
    let hit: { count: number; position: number };
    if (shared) {
      hit = { count: shared.filter((p) => p >= 0).length, position: shared[raw.index] };
    } else {
      hit = await locate(page, candidate, target);
      if (hit.count > 1) {
        shared = await page
          .locator(candidate)
          .evaluateAll((els, all) => (all as HTMLElement[]).map((h) => els.indexOf(h)), handles);
        sharedRoleMatches.set(candidate, shared);
      }
    }
    if (hit.count === 1 && hit.position === 0) return candidate;
    if (hit.position >= 0 && hit.count > 1) {
      const positional = `${candidate} >> nth=${hit.position}`;
      if (await isOnlyTarget(positional)) return positional;
    }
  }
  // Role matching missed (e.g. Chromium computes a different accessible name).
  const positional = `${positionalBase} >> nth=${raw.index}`;
  return (await isOnlyTarget(positional)) ? positional : undefined;
}

/**
 * Return structured page state (URL, title, visible interactive elements,
 * visible dialogs, the focused element, visible alert/status messages) an agent
 * can reason over to decide its next action. Walks visible interactive elements
 * and derives an accessible role/name for each — cheaper for the calling agent
 * to reason over than a raw HTML dump (per BRAINSTORMING_LOG.md).
 *
 * Name precedence (T017): aria-label > aria-labelledby > <label> > text content
 * > placeholder > title (> value, for button-type inputs only). A trimmed
 * empty string counts as missing at every step.
 *
 * Selector (T018): each element carries a Playwright selector for ui_click /
 * ui_fill, first unique of `[data-testid]` > `#id` > `role=…[name=…]` >
 * `role=… >> nth=i`, built in Node and verified against the live page.
 *
 * T030: elements carry a `state` (disabled/checked/value/expanded/selected/
 * pressed/required/invalid, non-default fields only; a password value is never
 * read), custom-widget roles are listed, `overlays` names the open dialogs
 * topmost first, and `focused` names the element holding focus.
 */
export async function getPageState(page: Page | undefined): Promise<PageState> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  // Handles pin the exact elements so selectors can be verified by identity.
  let handles: ElementHandle[] = [];
  let overlayHandles: ElementHandle[] = [];
  let focusEl: ElementHandle | null = null;
  try {
    handles = await page.$$(INTERACTIVE_SELECTOR);
    const focusHandle = await page.evaluateHandle(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement) return null;
      // A frame or shadow host is not the element that really has focus: omit rather than be wrong.
      if (active.tagName === "IFRAME" || active.tagName === "FRAME" || active.shadowRoot?.activeElement) {
        return null;
      }
      return active as HTMLElement;
    });
    focusEl = focusHandle.asElement();
    if (!focusEl) await focusHandle.dispose();

    // NOTE: no named inner functions/consts in these callbacks — tsx/esbuild wraps
    // them in a `__name` helper that does not exist in the browser context.
    const pass: { rows: RawPageElement[]; focusIndex: number } = await page.evaluate(
      ({ nodes, focus }) => {
        const all = focus && !nodes.includes(focus) ? [...nodes, focus] : nodes;
        const focusIndex = focus ? all.indexOf(focus) : -1;
        const tri = new Map<string, boolean | "mixed">([
          ["true", true],
          ["false", false],
          ["mixed", "mixed"],
        ]);
        const noValueTypes = ["password", "checkbox", "radio", "submit", "button", "reset", "image", "file", "hidden"];
        const rows = all.map((el, index) => {
          const rect = el.getBoundingClientRect();
          if (!(rect.width > 0 && rect.height > 0)) {
            return { index, visible: false, role: "", name: "", testId: "", id: "", state: null };
          }
          const explicitRole = el.getAttribute("role");
          const tag = el.tagName.toLowerCase();
          const input = el as HTMLInputElement;
          const inputRoles: Record<string, string> = {
            checkbox: "checkbox",
            radio: "radio",
            submit: "button",
            button: "button",
            reset: "button",
            image: "button",
            range: "slider",
          };
          const editable = el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false";
          const role =
            explicitRole ??
            (tag === "a"
              ? "link"
              : tag === "button"
                ? "button"
                : tag === "input"
                  ? (inputRoles[input.type] ?? "textbox")
                  : tag === "textarea"
                    ? "textbox"
                    : tag === "select"
                      ? "combobox"
                      : editable
                        ? "textbox"
                        : tag === "summary"
                          ? "button"
                          : tag);
          // `labels` resolves <label for> (by id, no CSS escaping) and wrapping labels.
          const labelText = input.labels ? Array.from(input.labels, (l) => l.innerText).join(" ") : "";
          const labelledByText = (el.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .map((id) => (id ? (document.getElementById(id)?.textContent ?? "") : ""))
            .join(" ");
          // Only button-type inputs are named by value; never text/password values.
          const buttonValue =
            tag === "input" && ["submit", "button", "reset"].includes(input.type) ? input.value : "";
          // Precedence: aria-label > aria-labelledby > label > text > placeholder > title > value.
          // A whitespace-only string counts as missing.
          const name =
            [
              el.getAttribute("aria-label"),
              labelledByText,
              labelText,
              (el as HTMLElement).innerText,
              input.placeholder,
              el.getAttribute("title"),
              buttonValue,
            ]
              .map((t) => (t ?? "").replace(/\s+/g, " ").trim())
              .find((t) => t.length > 0) ?? "";

          // State: only non-default fields. `value` is never read from a password input.
          const state: Record<string, unknown> = {};
          if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") state.disabled = true;
          const checked =
            tag === "input" && (input.type === "checkbox" || input.type === "radio")
              ? input.indeterminate
                ? "mixed"
                : input.checked
              : tri.get(el.getAttribute("aria-checked") ?? "");
          if (checked !== undefined) state.checked = checked;
          let value = "";
          if (tag === "input") {
            value = noValueTypes.includes(input.type) ? "" : input.value;
          } else if (tag === "textarea") {
            value = (el as HTMLTextAreaElement).value;
          } else if (tag === "select") {
            value = Array.from((el as HTMLSelectElement).selectedOptions, (o) => o.value).join(", ");
          } else if (el.hasAttribute("aria-valuenow")) {
            value = el.getAttribute("aria-valuetext") ?? el.getAttribute("aria-valuenow") ?? "";
          }
          if (value) state.value = value.length > 100 ? `${value.slice(0, 100)}…` : value;
          const expanded =
            tag === "summary" && el.parentElement?.tagName === "DETAILS"
              ? (el.parentElement as HTMLDetailsElement).open
              : tri.get(el.getAttribute("aria-expanded") ?? "");
          if (typeof expanded === "boolean") state.expanded = expanded;
          const selected = tri.get(el.getAttribute("aria-selected") ?? "");
          if (typeof selected === "boolean") state.selected = selected;
          const pressed = tri.get(el.getAttribute("aria-pressed") ?? "");
          if (pressed !== undefined) state.pressed = pressed;
          const required =
            tag === "input" || tag === "textarea" || tag === "select"
              ? input.required
              : el.getAttribute("aria-required") === "true";
          if (required) state.required = true;
          let invalid = ["true", "grammar", "spelling"].includes(el.getAttribute("aria-invalid") ?? "");
          if (!invalid) {
            try {
              invalid = el.matches(":user-invalid");
            } catch {
              // :user-invalid unsupported by this browser; aria-invalid alone then.
            }
          }
          if (invalid) state.invalid = true;

          return {
            index,
            visible: true,
            role,
            name: name.length > 80 ? `${name.slice(0, 80)}…` : name,
            testId: el.getAttribute("data-testid") ?? "",
            id: el.id,
            isSummary: tag === "summary",
            editableLabel: editable ? (el.getAttribute("aria-label") ?? "").trim() : "",
            state: Object.keys(state).length > 0 ? state : null,
          };
        });
        return { rows, focusIndex };
      },
      { nodes: handles, focus: focusEl }
    );

    const found = pass.rows
      .slice(0, handles.length)
      // Alerts/status regions are reported in `messages`, dialogs in `overlays`, not as elements.
      .filter((e) => e.visible && e.name.length > 0 && !NON_ELEMENT_ROLES.includes(e.role));
    const shown = found.slice(0, MAX_PAGE_ELEMENTS);
    const elements: PageElement[] = [];
    const sharedRoleMatches = new Map<string, number[]>();
    for (const r of shown) {
      const selector = await buildSelector(page, r, handles, sharedRoleMatches);
      // Unverifiable means the element vanished mid-read; omit rather than guess.
      if (selector) {
        const element: PageElement = { role: r.role, name: r.name, selector };
        if (r.state) element.state = r.state;
        elements.push(element);
      }
    }

    overlayHandles = await page.$$(OVERLAY_SELECTOR);
    const overlayRows: (RawElement & { modal: boolean })[] = await page.evaluate((nodes) => {
      const rows = nodes
        .map((el, index) => {
          const rect = el.getBoundingClientRect();
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(el).visibility !== "hidden" &&
            !el.closest('[aria-hidden="true"]');
          if (!visible) return null;
          const tag = el.tagName.toLowerCase();
          let topLayer = false;
          if (tag === "dialog") {
            try {
              topLayer = el.matches(":modal");
            } catch {
              // :modal unsupported; fall back to aria-modal alone.
            }
          }
          const labelledByText = (el.getAttribute("aria-labelledby") ?? "")
            .split(/\s+/)
            .map((id) => (id ? (document.getElementById(id)?.textContent ?? "") : ""))
            .join(" ");
          const heading = el.querySelector("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
          const name =
            [el.getAttribute("aria-label"), labelledByText, heading?.innerText, el.getAttribute("title")]
              .map((t) => (t ?? "").replace(/\s+/g, " ").trim())
              .find((t) => t.length > 0) ?? "";
          return {
            el,
            index,
            topLayer,
            z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
            role: el.getAttribute("role") || "dialog",
            name: name.length > 80 ? `${name.slice(0, 80)}…` : name,
            testId: el.getAttribute("data-testid") ?? "",
            id: el.id,
            modal: el.getAttribute("aria-modal") === "true" || topLayer,
          };
        })
        .filter((r) => r !== null);
      // Topmost first. A nested overlay sits above its ancestor whatever the z-index;
      // otherwise top-layer (showModal) beats z-index beats later-in-document.
      rows.sort((a, b) => {
        if (a.el.contains(b.el)) return 1;
        if (b.el.contains(a.el)) return -1;
        if (a.topLayer !== b.topLayer) return a.topLayer ? -1 : 1;
        if (a.z !== b.z) return b.z - a.z;
        return a.el.compareDocumentPosition(b.el) & 4 ? 1 : -1;
      });
      return rows.map((r) => ({
        index: r.index,
        role: r.role,
        name: r.name,
        testId: r.testId,
        id: r.id,
        modal: r.modal,
      }));
    }, overlayHandles);
    const overlays: PageOverlay[] = [];
    const overlayShared = new Map<string, number[]>();
    for (const r of overlayRows) {
      const selector = await buildSelector(page, r, overlayHandles, overlayShared, OVERLAY_SELECTOR);
      if (selector) overlays.push({ role: r.role, name: r.name, selector, modal: r.modal });
    }

    let focused: PageFocus | undefined;
    const focusRow = focusEl ? pass.rows[pass.focusIndex] : undefined;
    if (focusEl && focusRow?.visible) {
      // An element outside INTERACTIVE_SELECTOR sits after `handles` in the in-page pass.
      const selectorHandles = pass.focusIndex >= handles.length ? [...handles, focusEl] : handles;
      const selector = await buildSelector(page, focusRow, selectorHandles, new Map());
      if (selector) focused = { role: focusRow.role, name: focusRow.name, selector };
    }

    const messages = await page.$$eval(MESSAGE_SELECTOR, (nodes) => {
      const seen = new Set<string>();
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
        if (text) seen.add(text);
      }
      return Array.from(seen);
    });
    const result: PageState = {
      ok: true,
      url: page.url(),
      title: await page.title(),
      elements,
      messages,
    };
    if (overlays.length > 0) result.overlays = overlays;
    if (focused) result.focused = focused;
    if (found.length > shown.length) {
      result.note = `Showing first ${shown.length} of ${found.length} elements; use a CSS selector for the rest`;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    await Promise.all(
      [...handles, ...overlayHandles, ...(focusEl ? [focusEl] : [])].map((h) => h.dispose().catch(() => undefined))
    );
  }
}

/** `ui_get_text` is capped here so one call cannot flood the agent's context. */
const MAX_TEXT_CHARS = 4000;

export interface TextResult extends ActionResult {
  text?: string;
}

/** A blank `ui_get_text` selector means "no selector"; used by the tool so the report records the same. */
export function textSelectorOrUndefined(selector: string | undefined): string | undefined {
  return selector?.trim() || undefined;
}

/**
 * Read the trimmed visible text (`innerText`) of the single element matching
 * `selector`, or of `body` with no selector. Same 0/>1-match failure as `click`.
 * Text beyond MAX_TEXT_CHARS is cut and the note says how long it really was.
 */
export async function getText(page: Page | undefined, selector?: string): Promise<TextResult> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  let text = "";
  // An empty selector means "no selector": the whole page, not a Playwright parse error.
  const target = textSelectorOrUndefined(selector);
  const result = await onUniqueLocator(page, target ?? "body", async (locator) => {
    // innerText of a hidden element falls back to raw textContent (stale dialog/error text).
    // Not checked for the bare body: an empty page has a zero-size body that is still "the page".
    if (target && !(await locator.isVisible())) {
      return { ok: false, error: `Element "${target}" is not visible` };
    }
    const raw = (await locator.innerText({ timeout: 5_000 })).trim();
    text =
      raw.length > MAX_TEXT_CHARS ? `${raw.slice(0, MAX_TEXT_CHARS)}…(truncated, ${raw.length} chars)` : raw;
  });
  return result.ok ? { ok: true, text } : result;
}

export interface ScreenshotResult {
  ok: boolean;
  path?: string;
  /** Base64 PNG scaled to fit MAX_INLINE_WIDTH x MAX_INLINE_HEIGHT; only with `inline: true`. Never written to disk. */
  imageBase64?: string;
  /** Something the agent should know about the capture (e.g. a full page that was capped). */
  note?: string;
  error?: string;
}

export interface ScreenshotOptions {
  /** Capture just the single element matching this selector. */
  selector?: string;
  /** Capture the whole scrollable page (height capped at MAX_FULL_PAGE_HEIGHT). */
  fullPage?: boolean;
  /** Also return the PNG itself, scaled down, so the agent can look at it. */
  inline?: boolean;
}

/** Widest inline image returned to the agent; wider captures are scaled down. */
export const MAX_INLINE_WIDTH = 1280;
/** Tallest inline image: the Claude API rejects images over 8000px on either side. */
export const MAX_INLINE_HEIGHT = 8000;
/** Tallest full-page capture, in device pixels, to keep the PNG (and the report that embeds it) small. */
export const MAX_FULL_PAGE_HEIGHT = 16_000;
/** Widest full-page capture, in CSS pixels (the widest viewport `ui_set_viewport` accepts). */
export const MAX_FULL_PAGE_WIDTH = 3840;

/**
 * Scale `png` down to fit within `maxWidth` x `maxHeight`, keeping the aspect ratio, by
 * drawing it in a scratch context of the same browser (no image library needed; a
 * separate context so the session's device emulation, cookies and pages are untouched).
 * A PNG that already fits is returned as is, with `scaled: false`.
 */
async function scaleToFit(
  page: Page,
  png: Buffer,
  maxWidth: number,
  maxHeight: number
): Promise<{ png: Buffer; scaled: boolean; width: number; height: number }> {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width <= maxWidth && height <= maxHeight) return { png, scaled: false, width, height };
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser to scale with");
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  const scaledWidth = Math.max(1, Math.min(maxWidth, Math.round(width * ratio)));
  const scaledHeight = Math.max(1, Math.min(maxHeight, Math.round(height * ratio)));
  const scratch = await browser.newContext({ viewport: { width: scaledWidth, height: scaledHeight } });
  try {
    const scratchPage = await scratch.newPage();
    await scratchPage.setContent(
      `<body style="margin:0"><img style="display:block;width:${scaledWidth}px;height:${scaledHeight}px" src="data:image/png;base64,${png.toString("base64")}"></body>`
    );
    return { png: await scratchPage.screenshot({ type: "png" }), scaled: true, width: scaledWidth, height: scaledHeight };
  } finally {
    await scratch.close().catch(() => undefined);
  }
}

/**
 * Capture the current viewport (or one element, or the full page) and write it as a
 * PNG under `outputDir`. With `inline`, the PNG is also returned in memory, scaled to
 * fit MAX_INLINE_WIDTH x MAX_INLINE_HEIGHT: it is not written a second time.
 * Write failures (disk full, permissions) return a clear error instead of
 * crashing the session (Edge Case Checklist).
 */
export async function takeScreenshot(
  page: Page | undefined,
  outputDir: string,
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  const { selector, fullPage, inline } = options;
  if (selector !== undefined && fullPage) {
    return { ok: false, error: "Use either selector (one element) or fullPage (the whole page), not both" };
  }
  try {
    let locator: ReturnType<Page["locator"]> | undefined;
    if (selector !== undefined) {
      const resolved = await resolveUniqueLocator(page, selector);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      locator = resolved.locator;
    }
    await mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `screenshot-${Date.now()}.png`);
    let note: string | undefined;
    let png: Buffer;
    if (locator) {
      png = await locator.screenshot({ path: filePath, timeout: 5_000 });
    } else if (fullPage) {
      const size = (await page.evaluate(
        "({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, ratio: window.devicePixelRatio || 1 })"
      )) as { width: number; height: number; ratio: number };
      // The height cap is in device pixels (a ratio-3 phone would otherwise write 48000px); clip is in CSS pixels.
      const maxCssHeight = Math.floor(MAX_FULL_PAGE_HEIGHT / size.ratio);
      const width = Math.min(size.width, MAX_FULL_PAGE_WIDTH);
      const height = Math.min(size.height, maxCssHeight);
      const notes: string[] = [];
      if (size.height > maxCssHeight) {
        notes.push(`Page is ${size.height}px tall; the capture was cut at ${MAX_FULL_PAGE_HEIGHT}px`);
      }
      if (size.width > MAX_FULL_PAGE_WIDTH) {
        notes.push(`Page is ${size.width}px wide; the capture was cut at ${MAX_FULL_PAGE_WIDTH}px`);
      }
      if (notes.length > 0) {
        note = notes.join(". ");
        png = await page.screenshot({ path: filePath, fullPage: true, clip: { x: 0, y: 0, width, height } });
      } else {
        png = await page.screenshot({ path: filePath, fullPage: true });
      }
    } else {
      png = await page.screenshot({ path: filePath });
    }
    const result: ScreenshotResult = { ok: true, path: filePath };
    if (note) result.note = note;
    if (inline) {
      try {
        const fitted = await scaleToFit(page, png, MAX_INLINE_WIDTH, MAX_INLINE_HEIGHT);
        result.imageBase64 = fitted.png.toString("base64");
        if (fitted.scaled) {
          const from = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
          const scaledNote = `Inline image scaled to ${fitted.width}x${fitted.height} (file is ${from}); the file on disk is full size`;
          result.note = [note, scaledNote].filter(Boolean).join(". ");
        }
      } catch (err) {
        // The capture itself succeeded and is on disk; only the inline copy is missing.
        const reason = err instanceof Error ? err.message : String(err);
        result.note = [note, `Inline image unavailable (${reason}); read the file instead`].filter(Boolean).join(". ");
      }
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
