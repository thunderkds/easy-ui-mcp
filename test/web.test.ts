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

// T017: name resolution + on-page messages

const pageStateOf = async (html: string) => {
  await fixturePage.setContent(html, { waitUntil: "domcontentloaded" });
  return getPageState(fixturePage);
};

test("getPageState names inputs by label-for and placeholder, and reports alert text (T017 AC1,3,5)", async () => {
  const result = await pageStateOf(
    '<label for=e>Email</label><input id=e placeholder="you@x.com"><input placeholder="Search"><select><option>A</option></select><button>Save</button><div role=alert>Password too short</div>'
  );
  assert.equal(result.ok, true);
  assert.ok(result.elements?.some((e) => e.role === "textbox" && e.name === "Email"));
  assert.ok(result.elements?.some((e) => e.role === "textbox" && e.name === "Search"));
  assert.ok(result.elements?.some((e) => e.role === "combobox"));
  assert.ok(result.elements?.some((e) => e.role === "button" && e.name === "Save"));
  assert.deepEqual(result.messages, ["Password too short"]);
});

test("getPageState names a wrapped checkbox by its enclosing label (T017 AC2)", async () => {
  const result = await pageStateOf("<label>Remember me <input type=checkbox></label>");
  const box = result.elements?.[0];
  assert.ok(box, "checkbox input should be listed");
  assert.match(box.name, /Remember me/);
});

test("getPageState resolves label-for ids that are not valid CSS selectors (T017 edge)", async () => {
  const result = await pageStateOf("<label for='a.b:c'>Odd id</label><input id='a.b:c'>");
  assert.ok(result.elements?.some((e) => e.name === "Odd id"));
});

test("getPageState name precedence: aria-label > aria-labelledby > label > placeholder > title > text (T017 AC4)", async () => {
  const result = await pageStateOf(`
    <span id=l1>Via</span><span id=l2>Labelledby</span>
    <label for=a>Label A</label><input id=a aria-label="Aria" aria-labelledby="l1 l2" placeholder="PH" title="T">
    <label for=b>Label B</label><input id=b aria-labelledby="l1 missing l2" placeholder="PH" title="T">
    <label for=c>Label C</label><input id=c placeholder="PH" title="T">
    <input id=d placeholder="PH D" title="T">
    <input id=f title="Only title">
    <button id=g title="T">Button text</button>
    <input id=h aria-labelledby="nope" placeholder="Falls back">
    <input id=i aria-label="  " placeholder="Blank aria-label ignored">`);
  const names = (result.elements ?? []).map((e) => e.name);
  assert.deepEqual(names, [
    "Aria",
    "Via Labelledby",
    "Label C",
    "PH D",
    "Only title",
    "T", // title outranks text content per AC4
    "Falls back",
    "Blank aria-label ignored",
  ]);
});

test("getPageState never names a password input from its value (T017 edge)", async () => {
  const result = await pageStateOf(
    "<input type=password value=hunter2><label for=p>Password</label><input id=p type=password value=hunter2>"
  );
  const names = (result.elements ?? []).map((e) => e.name);
  assert.deepEqual(names, ["Password"]);
});

test("getPageState truncates very long names (T017 edge)", async () => {
  const result = await pageStateOf(`<button>${"x".repeat(200)}</button>`);
  const name = result.elements?.[0]?.name ?? "";
  assert.ok(name.length <= 81 && name.endsWith("…"));
});

test("getPageState keeps submit-button values and text-named buttons/links, drops unnamed/invisible elements (T017 AC6)", async () => {
  const result = await pageStateOf(
    '<input type=submit value="Go"><a href="#">Home</a><button></button><button style="display:none">Hidden</button><input style="display:none" placeholder="Nope">'
  );
  assert.deepEqual(
    (result.elements ?? []).map((e) => e.name),
    ["Go", "Home"]
  );
  assert.equal(result.elements?.[1]?.role, "link");
});

test("getPageState reports status and aria-live messages but not empty, hidden or aria-live=off ones (T017 AC5,7)", async () => {
  const shown = await pageStateOf(
    "<div role=status>Saved</div><p aria-live=polite> Loading… </p><div aria-live=off>quiet</div>"
  );
  assert.deepEqual(shown.messages, ["Saved", "Loading…"]);

  const none = await pageStateOf(
    '<div role=alert></div><div role=alert style="display:none">Hidden</div><div role=alert style="width:0;height:0;overflow:hidden">Zero</div>'
  );
  assert.deepEqual(none.messages, []);
});

test("getPageState reports an interactive alert as a message, not as an element (T017 edge)", async () => {
  const result = await pageStateOf("<button role=alert>Retry failed</button>");
  assert.deepEqual(result.messages, ["Retry failed"]);
  assert.deepEqual(result.elements, []);
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
