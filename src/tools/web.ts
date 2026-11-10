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

/**
 * Scroll the single element matching `selector` into view, or — with no selector —
 * the page down by one viewport. A page that cannot scroll is not an error.
 */
export async function scroll(page: Page, selector?: string): Promise<ActionResult> {
  if (selector === undefined) {
    try {
      await page.evaluate("window.scrollBy(0, window.innerHeight)");
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
  return onUniqueLocator(page, selector, async (locator) => {
    await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
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
  const target = selector?.trim() || undefined;
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
