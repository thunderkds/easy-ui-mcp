import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  navigate,
  click,
  fill,
  assertCondition,
  getPageState,
  takeScreenshot,
} from "../src/tools/web.js";

const FIXTURE_HTML = `
<!doctype html>
<html>
  <body>
    <button id="unique-btn" onclick="document.getElementById('result').textContent = 'clicked'">Click me</button>
    <button class="dup-btn">A</button>
    <button class="dup-btn">B</button>
    <input id="name" type="text" />
    <a href="#" id="link">A link</a>
    <p id="result"></p>
  </body>
</html>`;

let browser: Browser;
let page: Page;
let fixturePage: Page;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  // Separate page for the fixture (ui_click/fill/assert/state/screenshot) tests, so
  // the navigate() error-path tests above (which leave `page` mid-navigation to a
  // chrome-error document) can't interrupt setContent() on this page.
  fixturePage = await browser.newPage();
});

test.after(async () => {
  await browser.close();
});

test("navigate succeeds on a reachable page", async () => {
  const result = await navigate(page, "https://example.com");
  assert.equal(result.ok, true);
  assert.match(result.url, /example\.com/);
  assert.ok(result.title && result.title.length > 0);
});

test("navigate fails clearly on an unreachable URL (no hang, no throw)", async () => {
  const result = await navigate(page, "https://this-domain-does-not-exist-easy-ui-mcp.invalid");
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.length > 0);
});

test("navigate fails clearly on a malformed URL", async () => {
  const result = await navigate(page, "not-a-valid-url");
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.length > 0);
});

// --- ui_click ---

test("click succeeds on a unique selector match", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await click(fixturePage, "#unique-btn");
  assert.equal(result.ok, true);
  assert.equal(await fixturePage.textContent("#result"), "clicked");
});

test("click fails clearly when selector matches 0 elements", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await click(fixturePage, "#does-not-exist");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /#does-not-exist/);
});

test("click fails clearly when selector matches >1 elements (no silent first-match click)", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await click(fixturePage, ".dup-btn");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /\.dup-btn/);
});

// --- ui_fill ---

test("fill succeeds on a unique input selector", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await fill(fixturePage, "#name", "Alice");
  assert.equal(result.ok, true);
  assert.equal(await fixturePage.inputValue("#name"), "Alice");
});

test("fill fails clearly when selector matches 0 elements", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await fill(fixturePage, "#missing-input", "x");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /#missing-input/);
});

test("fill fails clearly when selector matches >1 elements", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await fill(fixturePage, ".dup-btn", "x");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /\.dup-btn/);
});

// --- ui_assert ---

test("assertCondition returns passed:true for a true condition", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await assertCondition(fixturePage, "document.getElementById('name') !== null");
  assert.equal(result.ok, true);
  assert.equal(result.passed, true);
});

test("assertCondition returns passed:false for a false condition", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await assertCondition(fixturePage, "document.getElementById('nope') !== null");
  assert.equal(result.ok, true);
  assert.equal(result.passed, false);
});

test("assertCondition fails clearly when no active page (no unhandled exception)", async () => {
  const result = await assertCondition(undefined, "true");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no active page/i);
});

// --- ui_get_page_state ---

test("getPageState returns URL, title, and visible interactive elements", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const result = await getPageState(fixturePage);
  assert.equal(result.ok, true);
  assert.ok(typeof result.url === "string");
  assert.ok(Array.isArray(result.elements));
  const names = (result.elements ?? []).map((e) => e.name);
  assert.ok(names.includes("Click me"));
  assert.ok(names.includes("A link"));
});

test("getPageState fails clearly when no active page", async () => {
  const result = await getPageState(undefined);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no active page/i);
});

// --- ui_take_screenshot ---

test("takeScreenshot writes a PNG file to the output dir and returns its path", async () => {
  await fixturePage.setContent(FIXTURE_HTML, { waitUntil: "domcontentloaded" });
  const outputDir = path.join(process.cwd(), "test", ".tmp-screenshots");
  try {
    const result = await takeScreenshot(fixturePage, outputDir);
    assert.equal(result.ok, true);
    assert.ok(result.path && existsSync(result.path));
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("takeScreenshot fails clearly when no active page", async () => {
  const result = await takeScreenshot(undefined, path.join(process.cwd(), "test", ".tmp-screenshots"));
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no active page/i);
});
