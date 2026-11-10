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
  /** Pass unchanged to ui_click / ui_fill; resolves to exactly this element. */
  selector: string;
}

export interface PageState {
  ok: boolean;
  url?: string;
  title?: string;
  elements?: PageElement[];
  messages?: string[];
  /** Set when `elements` was capped at MAX_PAGE_ELEMENTS. */
  note?: string;
  error?: string;
}

/** Bounds `ui_get_page_state` output (and selector-verification cost) on huge pages. */
const MAX_PAGE_ELEMENTS = 200;

const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"]';

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
  index: number; // position in INTERACTIVE_SELECTOR document order
  role: string;
  name: string;
  testId: string;
  id: string;
}

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
  sharedRoleMatches: Map<string, number[]>
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
  const positional = `${INTERACTIVE_SELECTOR} >> nth=${raw.index}`;
  return (await isOnlyTarget(positional)) ? positional : undefined;
}

/**
 * Return structured page state (URL, title, visible interactive elements,
 * visible alert/status messages) an agent can reason over to decide its next
 * action. Walks visible interactive elements and derives an accessible
 * role/name for each — cheaper for the calling agent to reason over than a raw
 * HTML dump (per BRAINSTORMING_LOG.md).
 *
 * Name precedence (T017): aria-label > aria-labelledby > <label> > text content
 * > placeholder > title (> value, for button-type inputs only). A trimmed
 * empty string counts as missing at every step.
 *
 * Selector (T018): each element carries a Playwright selector for ui_click /
 * ui_fill, first unique of `[data-testid]` > `#id` > `role=…[name=…]` >
 * `role=… >> nth=i`, built in Node and verified against the live page.
 */
export async function getPageState(page: Page | undefined): Promise<PageState> {
  if (!page) {
    return { ok: false, error: "No active page — call ui_navigate first" };
  }
  // Handles pin the exact elements so selectors can be verified by identity.
  let handles: ElementHandle[] = [];
  try {
    handles = await page.$$(INTERACTIVE_SELECTOR);
    // NOTE: no named inner functions/consts in these callbacks — tsx/esbuild wraps
    // them in a `__name` helper that does not exist in the browser context.
    const found: RawElement[] = await page.evaluate(
      (nodes) =>
        nodes
          .map((el, index) => ({ el, index }))
          .filter(({ el }) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(({ el, index }) => {
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
                        : tag);
            // `labels` resolves <label for> (by id, no CSS escaping) and wrapping labels.
            const labelText = input.labels
              ? Array.from(input.labels, (l) => l.innerText).join(" ")
              : "";
            const labelledByText = (el.getAttribute("aria-labelledby") ?? "")
              .split(/\s+/)
              .map((id) => (id ? (document.getElementById(id)?.textContent ?? "") : ""))
              .join(" ");
            // Only button-type inputs are named by value; never text/password values.
            const buttonValue =
              tag === "input" && ["submit", "button", "reset"].includes(input.type)
                ? input.value
                : "";
            // Precedence: aria-label > aria-labelledby > label > text > placeholder > title > value.
            // A whitespace-only string counts as missing.
            const name = [
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
            return {
              index,
              role,
              name: name.length > 80 ? `${name.slice(0, 80)}…` : name,
              testId: el.getAttribute("data-testid") ?? "",
              id: el.id,
            };
          })
          // Alerts/status regions are reported in `messages`, not as elements.
          .filter((e) => e.name.length > 0 && e.role !== "alert" && e.role !== "status"),
      handles
    );
    const shown = found.slice(0, MAX_PAGE_ELEMENTS);
    const elements: PageElement[] = [];
    const sharedRoleMatches = new Map<string, number[]>();
    for (const r of shown) {
      const selector = await buildSelector(page, r, handles, sharedRoleMatches);
      // Unverifiable means the element vanished mid-read; omit rather than guess.
      if (selector) elements.push({ role: r.role, name: r.name, selector });
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
    if (found.length > shown.length) {
      result.note = `Showing first ${shown.length} of ${found.length} elements; use a CSS selector for the rest`;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    await Promise.all(handles.map((h) => h.dispose().catch(() => undefined)));
  }
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
