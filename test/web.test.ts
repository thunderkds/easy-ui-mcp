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
  selectOption,
  pressKey,
  hover,
  setChecked,
  scroll,
  getText,
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

test("getPageState name precedence: aria-label > aria-labelledby > label > text > placeholder > title (T017 AC4)", async () => {
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
    "Button text", // visible text outranks title
    "Falls back",
    "Blank aria-label ignored",
  ]);
});

test("getPageState falls back to title when it is the only name source (T017 AC4)", async () => {
  const result = await pageStateOf(
    '<button title="Close dialog"><svg width=10 height=10></svg></button><input title="Zip code">'
  );
  assert.deepEqual(
    (result.elements ?? []).map((e) => `${e.role}:${e.name}`),
    ["button:Close dialog", "textbox:Zip code"]
  );
});

test("getPageState maps input types to roles, explicit role attribute wins (T017 role mapping)", async () => {
  const result = await pageStateOf(`
    <input type=checkbox aria-label="c"><input type=radio aria-label="r">
    <input type=submit value="s"><input type=button value="b"><input type=reset value="x">
    <input type=image alt="i" aria-label="img" width=10 height=10>
    <input type=range aria-label="slide"><input type=text aria-label="t"><input type=email aria-label="e">
    <input type=checkbox role=switch aria-label="sw"><textarea aria-label="ta"></textarea>`);
  assert.deepEqual(
    (result.elements ?? []).map((e) => `${e.role}:${e.name}`),
    [
      "checkbox:c",
      "radio:r",
      "button:s",
      "button:b",
      "button:x",
      "button:img",
      "slider:slide",
      "textbox:t",
      "textbox:e",
      "switch:sw",
      "textbox:ta",
    ]
  );
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
    (result.elements ?? []).map((e) => `${e.role}:${e.name}`),
    ["button:Go", "link:Home"]
  );
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

// T018: actionable selector per element

type StateElement = NonNullable<Awaited<ReturnType<typeof getPageState>>["elements"]>[number];

/** Every selector must resolve to exactly one element on the live page. */
const assertAllSelectorsUnique = async (elements: StateElement[]) => {
  for (const e of elements) {
    assert.equal(typeof e.selector, "string", `${e.role}:${e.name} has a selector`);
    assert.equal(await fixturePage.locator(e.selector).count(), 1, `selector ${e.selector} must match once`);
  }
};

test("getPageState selectors follow the strategy order and round-trip through click/fill (T018 AC1-3)", async () => {
  const result = await pageStateOf(`
    <button onclick="log('del0')">Delete</button>
    <button onclick="log('del1')">Delete</button>
    <button data-testid="save" onclick="log('save')">Save</button>
    <input id="a:b" placeholder="Name" oninput="log('name=' + this.value)">
    <a href="#" onclick="log('help'); return false">Help "me"</a>
    <p id="out"></p>
    <script>window.log = (m) => { document.getElementById('out').textContent += m + ';'; };</script>`);
  const els = result.elements ?? [];
  assert.deepEqual(
    els.map((e) => e.selector),
    [
      'role=button[name="Delete"] >> nth=0',
      'role=button[name="Delete"] >> nth=1',
      '[data-testid="save"]',
      "#a\\:b",
      'role=link[name="Help \\"me\\""]',
    ]
  );
  await assertAllSelectorsUnique(els);

  // Observable side effects prove each selector hit the intended element.
  const sel = (i: number) => els[i].selector;
  assert.equal((await click(fixturePage, sel(1))).ok, true);
  assert.equal((await click(fixturePage, sel(0))).ok, true);
  assert.equal((await click(fixturePage, sel(2))).ok, true);
  assert.equal((await fill(fixturePage, sel(3), "Bob")).ok, true);
  assert.equal((await click(fixturePage, sel(4))).ok, true);
  assert.equal(await fixturePage.textContent("#out"), "del1;del0;save;name=Bob;help;");
});

test("getPageState selectors work for an unlabeled-but-placeholdered input and ids that are not CSS identifiers (T018 AC2,3 / edge)", async () => {
  const result = await pageStateOf(
    '<input id="1st" placeholder="First"><input id="a.b c" placeholder="Second"><input placeholder="Third">'
  );
  const els = result.elements ?? [];
  assert.deepEqual(
    els.map((e) => e.selector),
    ["#\\31 st", "#a\\.b\\ c", 'role=textbox[name="Third"]']
  );
  await assertAllSelectorsUnique(els);
  for (const [i, v] of ["one", "two", "three"].entries()) {
    assert.equal((await fill(fixturePage, els[i].selector, v)).ok, true);
  }
  assert.deepEqual(
    await fixturePage.$$eval("input", (n) => n.map((x) => (x as HTMLInputElement).value)),
    ["one", "two", "three"]
  );
});

test("getPageState rejects an id that is duplicated on the page (T018 edge)", async () => {
  const result = await pageStateOf(
    '<button id=dup onclick="document.title=\'first\'">First</button><button id=dup onclick="document.title=\'second\'">Second</button>'
  );
  const els = result.elements ?? [];
  assert.deepEqual(
    els.map((e) => e.selector),
    ['role=button[name="First"]', 'role=button[name="Second"]']
  );
  await assertAllSelectorsUnique(els);
  await click(fixturePage, els[1].selector);
  assert.equal(await fixturePage.title(), "second");
});

test("getPageState rejects a duplicated data-testid and falls through to the id (T018 AC2)", async () => {
  const result = await pageStateOf('<button data-testid=x id=one>One</button><button data-testid=x id=two>Two</button>');
  assert.deepEqual((result.elements ?? []).map((e) => e.selector), ["#one", "#two"]);
});

test("getPageState escapes quotes and backslashes in names and test ids so the selector parses (T018 AC4)", async () => {
  const result = await pageStateOf(String.raw`
    <button onclick="document.title='q'">Say "hi"</button>
    <button onclick="document.title='b'">C:\temp\new</button>
    <button data-testid='we"ird\id' onclick="document.title='t'">Tid</button>
    <button onclick="document.title='s'">It's</button>`);
  const els = result.elements ?? [];
  assert.deepEqual(
    els.map((e) => e.selector),
    [
      String.raw`role=button[name="Say \"hi\""]`,
      String.raw`role=button[name="C:\\temp\\new"]`,
      String.raw`[data-testid="we\"ird\\id"]`,
      `role=button[name="It's"]`,
    ]
  );
  await assertAllSelectorsUnique(els);
  for (const [i, t] of ["q", "b", "t", "s"].entries()) {
    assert.equal((await click(fixturePage, els[i].selector)).ok, true);
    assert.equal(await fixturePage.title(), t);
  }
});

test("getPageState hostile page content cannot make a selector target a different element (T018 injection)", async () => {
  const result = await pageStateOf(`
    <button onclick="document.title='victim'">Pay</button>
    <button onclick="document.title='evil1'">x"] >> text=Pay >> nth=0 >> [name="y</button>
    <button id='a" ] , button' onclick="document.title='evil2'">Two</button>
    <button data-testid='x"], [data-testid="' onclick="document.title='evil3'">Three</button>
    <button role="button]x" onclick="document.title='evil4'">Four</button>`);
  const els = result.elements ?? [];
  assert.equal(els.length, 5);
  await assertAllSelectorsUnique(els);
  const titles: string[] = [];
  for (const e of els) {
    await fixturePage.evaluate(() => (document.title = ""));
    assert.equal((await click(fixturePage, e.selector)).ok, true);
    titles.push(await fixturePage.title());
  }
  assert.deepEqual(titles, ["victim", "evil1", "evil2", "evil3", "evil4"]);
});

test("getPageState disambiguates names that are substrings of one another (T018 AC2)", async () => {
  const result = await pageStateOf(
    '<button onclick="document.title=\'short\'">Save</button><button onclick="document.title=\'long\'">Save as draft</button>'
  );
  const els = result.elements ?? [];
  await assertAllSelectorsUnique(els);
  await click(fixturePage, els[0].selector);
  assert.equal(await fixturePage.title(), "short");
  await click(fixturePage, els[1].selector);
  assert.equal(await fixturePage.title(), "long");
});

test("getPageState falls back to a positional selector when role matching cannot find the element (T018 edge)", async () => {
  // Names over 80 chars are truncated in the output, so the role selector can't match.
  const long = "y".repeat(100);
  const result = await pageStateOf(
    `<button onclick="document.title='first'">${long}</button><button onclick="document.title='second'">${long}z</button>`
  );
  const els = result.elements ?? [];
  assert.equal(els.length, 2);
  await assertAllSelectorsUnique(els);
  await click(fixturePage, els[1].selector);
  assert.equal(await fixturePage.title(), "second");
  await click(fixturePage, els[0].selector);
  assert.equal(await fixturePage.title(), "first");
});

test("getPageState selectors are right when invisible and unnamed elements sit between visible ones (T018 edge)", async () => {
  const result = await pageStateOf(
    '<button style="display:none">Delete</button><button></button><button onclick="document.title=\'b\'">Delete</button><button onclick="document.title=\'c\'">Delete</button>'
  );
  const els = result.elements ?? [];
  assert.equal(els.length, 2);
  await assertAllSelectorsUnique(els);
  await click(fixturePage, els[1].selector);
  assert.equal(await fixturePage.title(), "c");
});

test("getPageState gives every element of a realistic form a unique selector (T018 success criterion 2)", async () => {
  const result = await pageStateOf(`
    <nav><a href="#home">Home</a><a href="#docs">Docs</a><a href="#docs">Docs</a></nav>
    <form>
      <label for=u>User</label><input id=u>
      <label>Remember <input type=checkbox></label>
      <label><input type=radio name=r> Yes</label><label><input type=radio name=r> No</label>
      <select aria-label="Country"><option>A</option></select>
      <textarea placeholder="Notes"></textarea>
      <input type=submit value="Go"><button type=reset>Reset</button>
    </form>
    <div role=button tabindex=0>Fake button</div><div role=tab>Tab</div><div role=menuitem>Menu</div>`);
  const els = result.elements ?? [];
  assert.ok(els.length >= 12);
  await assertAllSelectorsUnique(els);
});

test("getPageState caps elements at 200 with a truncation note and stays fast (T018 AC6)", async () => {
  const many = Array.from({ length: 500 }, (_, i) => `<button>Item</button>`).join("");
  const started = Date.now();
  const result = await pageStateOf(many);
  const elapsed = Date.now() - started;
  assert.equal(result.elements?.length, 200);
  assert.match(result.note ?? "", /200 of 500/);
  // Deliberately loose: T018's target was ~2s on an idle machine, but wall-clock asserts flake under
  // load (4277ms seen at load average ~22). This ceiling only catches pathological regressions.
  assert.ok(elapsed < 20_000, `took ${elapsed}ms`);
  await assertAllSelectorsUnique((result.elements ?? []).slice(0, 5));

  const few = await pageStateOf("<button>One</button>");
  assert.equal(few.note, undefined);
});

// --- T030: element state, custom widgets, overlays, focus, ui_get_text ---

const byName = (els: StateElement[] | undefined, name: string) => (els ?? []).find((e) => e.name === name);

test("getPageState reports element state, lists custom widgets, and every selector round-trips (T030 AC1,2)", async () => {
  const result = await pageStateOf(`
    <button id="off" disabled>Off</button>
    <input id="agree" type="checkbox" checked aria-label="Agree">
    <input id="newsletter" type="checkbox" aria-label="Newsletter">
    <input id="user" aria-label="User" value="jcarlin" required>
    <input id="pw" type="password" aria-label="Password" value="hunter2">
    <textarea id="bio" aria-label="Bio">hello bio</textarea>
    <select id="country" aria-label="Country"><option value="us">US</option><option value="vn" selected>VN</option></select>
    <button id="acc" aria-expanded="false">Accordion</button>
    <div id="combo" role="combobox" aria-expanded="true" tabindex="0" aria-label="City">Hanoi</div>
    <ul role="listbox" aria-label="Cities"><li role="option" aria-selected="true" id="o1">Hanoi</li><li role="option" id="o2">Hue</li></ul>
    <div id="sw" role="switch" aria-checked="true" tabindex="0" aria-label="Dark mode">.</div>
    <div id="mixed" role="checkbox" aria-checked="mixed" tabindex="0" aria-label="Some">.</div>
    <button id="bold" aria-pressed="true">Bold</button>
    <div id="slider" role="slider" aria-valuenow="7" tabindex="0" aria-label="Volume">.</div>
    <details><summary id="sum">More</summary>Body</details>
    <div id="rte" contenteditable="true" aria-label="Editor">draft text</div>
    <div id="nope" contenteditable="false">Not editable</div>
    <div id="bad" role="textbox" tabindex="0" aria-invalid="true" aria-label="Email">.</div>
    <div id="layout" tabindex="0">A layout div with tabindex but no role</div>
    <div id="skipped" role="row" tabindex="-1">Roving row</div>`);
  const els = result.elements ?? [];
  assert.deepEqual(byName(els, "Off")?.state, { disabled: true });
  assert.deepEqual(byName(els, "Agree")?.state, { checked: true });
  assert.deepEqual(byName(els, "Newsletter")?.state, { checked: false });
  assert.deepEqual(byName(els, "User")?.state, { value: "jcarlin", required: true });
  assert.equal(byName(els, "Password")?.state?.value, undefined, "password value must never be returned");
  assert.ok(!JSON.stringify(result).includes("hunter2"));
  assert.deepEqual(byName(els, "Bio")?.state, { value: "hello bio" });
  assert.deepEqual(byName(els, "Country")?.state, { value: "vn" });
  assert.deepEqual(byName(els, "Accordion")?.state, { expanded: false });
  assert.equal(byName(els, "City")?.role, "combobox");
  assert.deepEqual(byName(els, "City")?.state, { expanded: true });
  assert.equal(byName(els, "Cities")?.role, "listbox");
  assert.deepEqual(byName(els, "Hanoi")?.state, { selected: true });
  assert.equal(byName(els, "Hue")?.role, "option");
  assert.deepEqual(byName(els, "Dark mode")?.state, { checked: true });
  assert.deepEqual(byName(els, "Some")?.state, { checked: "mixed" });
  assert.deepEqual(byName(els, "Bold")?.state, { pressed: true });
  assert.deepEqual(byName(els, "Volume")?.state, { value: "7" });
  assert.deepEqual(byName(els, "More")?.state, { expanded: false });
  assert.equal(byName(els, "Editor")?.role, "textbox");
  assert.equal(byName(els, "Not editable"), undefined);
  assert.deepEqual(byName(els, "Email")?.state, { invalid: true });
  assert.equal(byName(els, "A layout div with tabindex but no role"), undefined);
  assert.equal(byName(els, "Roving row"), undefined);
  // An element with no non-default state has no `state` key at all.
  assert.equal("state" in (byName(els, "Cities") ?? {}), false);

  await assertAllSelectorsUnique(els);
});

test("getPageState selectors for custom widgets hit the intended element (T030 AC2 round-trip)", async () => {
  const result = await pageStateOf(`
    <div id="combo" role="combobox" tabindex="0" aria-label="City" onclick="log('combo')">Pick</div>
    <div role="switch" aria-checked="false" tabindex="0" aria-label="Dark mode" onclick="this.setAttribute('aria-checked','true'); log('switch')">.</div>
    <div role="option" onclick="log('opt')">Hue</div>
    <div contenteditable="true" aria-label="Editor">.</div>
    <details><summary onclick="log('sum')">More</summary>Body</details>
    <p id="out"></p>
    <script>window.log = (m) => { document.getElementById('out').textContent += m + ';'; };</script>`);
  const els = result.elements ?? [];
  for (const name of ["City", "Dark mode", "Hue", "More"]) {
    const el = byName(els, name);
    assert.ok(el, `${name} listed`);
    assert.equal((await click(fixturePage, el.selector)).ok, true, `click ${name}`);
  }
  assert.equal(await fixturePage.textContent("#out"), "combo;switch;opt;sum;");
  const editor = byName(els, "Editor");
  assert.ok(editor);
  assert.equal((await fill(fixturePage, editor.selector, "typed")).ok, true);
  assert.equal(await fixturePage.textContent('[aria-label="Editor"]'), "typed");
});

test("getPageState truncates a long input value to 100 chars (T030 edge)", async () => {
  const result = await pageStateOf(`<input aria-label="Long" value="${"v".repeat(300)}">`);
  const value = byName(result.elements, "Long")?.state?.value ?? "";
  assert.ok(value.length <= 101, `value was ${value.length} chars`);
  assert.ok(value.startsWith("vvvv"));
});

test("getPageState lists an open modal dialog and drops it once closed (T030 AC3,4)", async () => {
  await fixturePage.setContent(
    `<button>Behind</button><dialog id="dlg" aria-label="Confirm delete"><button>OK</button></dialog>`,
    { waitUntil: "domcontentloaded" }
  );
  const closed = await getPageState(fixturePage);
  assert.equal("overlays" in closed, false, "no overlays key while closed");

  await fixturePage.evaluate("document.getElementById('dlg').showModal()");
  const open = await getPageState(fixturePage);
  assert.equal(open.overlays?.length, 1);
  assert.equal(open.overlays?.[0].role, "dialog");
  assert.equal(open.overlays?.[0].name, "Confirm delete");
  assert.equal(open.overlays?.[0].modal, true);
  assert.equal(await fixturePage.locator(open.overlays![0].selector).count(), 1);

  await fixturePage.evaluate("document.getElementById('dlg').close()");
  const after = await getPageState(fixturePage);
  assert.equal("overlays" in after, false, "no overlays key after close");
});

test("getPageState: <dialog open> without showModal is not modal; a name falls back to the heading (T030 edge)", async () => {
  const result = await pageStateOf(`<dialog open><h2>Heads up</h2><p>text</p></dialog>`);
  assert.equal(result.overlays?.length, 1);
  assert.equal(result.overlays?.[0].modal, false);
  assert.equal(result.overlays?.[0].name, "Heads up");
});

test("getPageState ignores overlays hidden by every means, and tracks an aria-modal div toggled with hidden (T030 AC3,4)", async () => {
  const hiddenWays = `
    <div role="dialog" hidden>a</div>
    <div role="dialog" style="display:none">b</div>
    <div role="dialog" style="visibility:hidden">c</div>
    <div role="alertdialog" aria-hidden="true">d</div>
    <div aria-hidden="true"><div role="dialog">e</div></div>`;
  const none = await pageStateOf(hiddenWays);
  assert.equal("overlays" in none, false);

  await fixturePage.setContent(
    `<div id="m" role="dialog" aria-modal="true" aria-label="Settings" hidden><button>Close</button></div>`,
    { waitUntil: "domcontentloaded" }
  );
  assert.equal("overlays" in (await getPageState(fixturePage)), false);
  await fixturePage.evaluate("document.getElementById('m').hidden = false");
  const open = await getPageState(fixturePage);
  assert.equal(open.overlays?.[0].name, "Settings");
  assert.equal(open.overlays?.[0].modal, true);
  await fixturePage.evaluate("document.getElementById('m').remove()");
  assert.equal("overlays" in (await getPageState(fixturePage)), false);
});

test("getPageState lists nested overlays topmost first (T030 edge)", async () => {
  const result = await pageStateOf(`
    <div role="dialog" aria-label="Outer" style="position:fixed;top:0;left:0;width:300px;height:300px;z-index:10">
      <div role="alertdialog" aria-label="Inner" style="position:absolute;top:10px;left:10px;width:100px;height:100px">x</div>
    </div>`);
  assert.deepEqual(
    (result.overlays ?? []).map((o) => o.name),
    ["Inner", "Outer"]
  );
});

test("getPageState reports the focused element, and omits it after blur (T030 AC5)", async () => {
  await fixturePage.setContent(`<input id="email" aria-label="Email"><button>Go</button>`, {
    waitUntil: "domcontentloaded",
  });
  assert.equal("focused" in (await getPageState(fixturePage)), false, "nothing focused → omitted");
  await fixturePage.focus("#email");
  const focused = (await getPageState(fixturePage)).focused;
  assert.equal(focused?.role, "textbox");
  assert.equal(focused?.name, "Email");
  assert.equal(await fixturePage.locator(focused!.selector).count(), 1);
  await fixturePage.evaluate("document.getElementById('email').blur()");
  assert.equal("focused" in (await getPageState(fixturePage)), false);
});

test("getPageState reports focus on an element outside the interactive list, but not an iframe (T030 edge)", async () => {
  await pageStateOf(
    `<div id="panel" tabindex="-1" aria-label="Results panel">x</div><iframe id="f" srcdoc="<input id=i>"></iframe>`
  );
  await fixturePage.focus("#panel");
  const onPanel = (await getPageState(fixturePage)).focused;
  assert.equal(onPanel?.name, "Results panel");
  assert.equal(await fixturePage.locator(onPanel!.selector).count(), 1);
  await fixturePage.focus("#f");
  assert.equal("focused" in (await getPageState(fixturePage)), false);
});

const LONG_BODY = `<p id="total">  $1,234.50 </p><p id="a2" class="dup">x</p><p class="dup">y</p><div>${"z".repeat(10_000)}</div>`;

test("getText returns the trimmed text of one element, or of body, capped at 4000 chars (T030 AC6)", async () => {
  await fixturePage.setContent(LONG_BODY, { waitUntil: "domcontentloaded" });
  const cell = await getText(fixturePage, "#total");
  assert.equal(cell.ok, true);
  assert.equal(cell.text, "$1,234.50");

  const body = await getText(fixturePage);
  assert.equal(body.ok, true);
  assert.ok((body.text ?? "").startsWith("$1,234.50"));
  assert.match(body.text ?? "", /…\(truncated, \d{5} chars\)$/);
  assert.ok((body.text ?? "").length < 4100);

  await fixturePage.setContent("<p id='s'>short</p>", { waitUntil: "domcontentloaded" });
  assert.equal((await getText(fixturePage)).text, "short");
});

test("getText fails like ui_click on 0 or >1 matches and with no page (T030 AC7)", async () => {
  await fixturePage.setContent(LONG_BODY, { waitUntil: "domcontentloaded" });
  const none = await getText(fixturePage, "#nope");
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /No element matched selector "#nope"/);
  const many = await getText(fixturePage, ".dup");
  assert.equal(many.ok, false);
  assert.match(many.error ?? "", /matched 2 elements/);
  const noPage = await getText(undefined, "#total");
  assert.equal(noPage.ok, false);
  assert.match(noPage.error ?? "", /no active page/i);
});

test("getText fails on a hidden element instead of returning its stale text (T030 AC6)", async () => {
  await fixturePage.setContent(
    `<dialog id="d"><p>Really?</p><button>OK</button></dialog><p id="gone" style="display:none">old error</p><p id="vh" style="visibility:hidden">ghost</p>`,
    { waitUntil: "domcontentloaded" }
  );
  await fixturePage.evaluate("document.getElementById('d').showModal()");
  const open = await getText(fixturePage, "#d");
  assert.equal(open.ok, true);
  assert.match(open.text ?? "", /Really\?/);

  await fixturePage.evaluate("document.getElementById('d').close()");
  for (const sel of ["#d", "#gone", "#vh"]) {
    const hidden = await getText(fixturePage, sel);
    assert.equal(hidden.ok, false, sel);
    assert.equal(hidden.text, undefined, sel);
    assert.match(hidden.error ?? "", new RegExp(`Element "${sel}" is not visible`));
  }
});

test("getText treats an empty or whitespace selector as the whole body (T030)", async () => {
  await fixturePage.setContent("<p>hello page</p>", { waitUntil: "domcontentloaded" });
  for (const sel of ["", "   "]) {
    const result = await getText(fixturePage, sel);
    assert.equal(result.ok, true, JSON.stringify(sel));
    assert.equal(result.text, "hello page");
  }
});

test("getPageState gives a contenteditable a short stable selector, not a positional one (T030 AC2)", async () => {
  const result = await pageStateOf(`
    <div contenteditable="true" aria-label='Not"es'>.</div>
    <div contenteditable="true" aria-label="Other">.</div>
    <div contenteditable="" aria-label="Twin">.</div><div contenteditable="true" aria-label="Twin">.</div>`);
  const notes = byName(result.elements, 'Not"es');
  assert.ok(notes);
  assert.equal(notes.role, "textbox");
  assert.ok(!notes.selector.includes("nth="), notes.selector);
  assert.ok(notes.selector.length < 80, notes.selector);
  assert.equal(await fixturePage.locator(notes.selector).count(), 1);
  assert.equal((await fill(fixturePage, notes.selector, "typed")).ok, true);
  assert.equal(await fixturePage.locator(notes.selector).textContent(), "typed");
  // Two identical names stay unique via the positional fallback.
  await assertAllSelectorsUnique((result.elements ?? []).filter((e) => e.name === "Twin"));
});

// --- ui_take_screenshot ---

// --- T019: interaction primitives ---

const INTERACT_HTML = `
<!doctype html>
<html>
  <body style="margin:0">
    <select id="country">
      <option value="us">United States</option>
      <option value="vn">Vietnam</option>
    </select>
    <select id="multi" multiple>
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
    </select>
    <select class="dup"><option value="1">One</option></select>
    <select class="dup"><option value="1">One</option></select>
    <form id="f" onsubmit="event.preventDefault(); document.getElementById('submitted').textContent = 'submitted:' + this.q.value">
      <input id="q" name="q" type="text" />
    </form>
    <input id="keys" type="text" onkeydown="document.getElementById('lastkey').textContent = event.key" />
    <span id="lastkey"></span>
    <p id="submitted"></p>
    <style>
      #menu .sub { display: none; }
      #menu:hover .sub { display: block; }
    </style>
    <div id="menu">Menu<div class="sub" id="sub">Submenu item</div></div>
    <input id="terms" type="checkbox" />
    <input id="agreed" type="checkbox" checked />
    <input id="r1" type="radio" name="g" />
    <input id="r2" type="radio" name="g" />
    <button id="not-a-box">Not a box</button>
    <div style="height:3000px"></div>
    <div id="footer">Footer</div>
  </body>
</html>`;

async function interactPage(): Promise<Page> {
  await fixturePage.setContent(INTERACT_HTML, { waitUntil: "domcontentloaded" });
  return fixturePage;
}

test("selectOption selects by option value and by visible label (T019 AC1)", async () => {
  const p = await interactPage();
  assert.deepEqual(await selectOption(p, "#country", "vn"), { ok: true });
  assert.equal(await p.inputValue("#country"), "vn");
  assert.deepEqual(await selectOption(p, "#country", "United States"), { ok: true });
  assert.equal(await p.inputValue("#country"), "us");
});

test("selectOption fails clearly on an unknown option, naming it and listing the choices (T019 AC8)", async () => {
  const p = await interactPage();
  const result = await selectOption(p, "#country", "Atlantis");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Atlantis/);
  assert.match(result.error ?? "", /Vietnam/);
  assert.equal(await p.inputValue("#country"), "us", "selection unchanged");
});

test("selectOption fails clearly on a non-select element (T019 AC8)", async () => {
  const p = await interactPage();
  const result = await selectOption(p, "#not-a-box", "x");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /not a <select>/);
});

test("selectOption on a <select multiple> selects exactly the one value (T019 edge)", async () => {
  const p = await interactPage();
  await selectOption(p, "#multi", "a");
  await selectOption(p, "#multi", "b");
  assert.deepEqual(await p.locator("#multi").evaluate((el) => Array.from((el as HTMLSelectElement).selectedOptions).map((o) => o.value)), ["b"]);
});

test("selectOption/pressKey/hover/setChecked/scroll require exactly one match (T019 AC6)", async () => {
  const p = await interactPage();
  for (const result of [
    await selectOption(p, ".dup", "1"),
    await pressKey(p, "Enter", ".dup"),
    await hover(p, ".dup"),
    await setChecked(p, ".dup", true),
    await scroll(p, ".dup"),
  ]) {
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /matched 2 elements/);
  }
  for (const result of [
    await selectOption(p, "#nope", "1"),
    await pressKey(p, "Enter", "#nope"),
    await hover(p, "#nope"),
    await setChecked(p, "#nope", true),
    await scroll(p, "#nope"),
  ]) {
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /No element matched selector "#nope"/);
  }
});

test("pressKey Enter in a text input submits its form (T019 AC2)", async () => {
  const p = await interactPage();
  await fill(p, "#q", "hello");
  assert.deepEqual(await pressKey(p, "Enter", "#q"), { ok: true });
  assert.equal(await p.textContent("#submitted"), "submitted:hello");
});

test("pressKey without a selector presses on the focused element (T019 AC2)", async () => {
  const p = await interactPage();
  await p.focus("#keys");
  assert.deepEqual(await pressKey(p, "ArrowDown"), { ok: true });
  assert.equal(await p.textContent("#lastkey"), "ArrowDown");
});

test("pressKey with nothing focused presses on body and does not fail (T019 edge)", async () => {
  const p = await interactPage();
  await p.evaluate("document.activeElement && document.activeElement.blur()");
  assert.deepEqual(await pressKey(p, "Escape"), { ok: true });
});

test("pressKey fails clearly on an unknown key name, with or without a selector (T019 AC8)", async () => {
  const p = await interactPage();
  for (const result of [await pressKey(p, "Enterr"), await pressKey(p, "Enterr", "#q")]) {
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Unknown key.*Enterr/);
  }
});

test("hover reveals :hover content (T019 AC3)", async () => {
  const p = await interactPage();
  assert.equal(await p.locator("#sub").isVisible(), false);
  assert.deepEqual(await hover(p, "#menu"), { ok: true });
  assert.equal(await p.locator("#sub").isVisible(), true);
});

test("setChecked checks, unchecks and is idempotent (T019 AC4 / edge)", async () => {
  const p = await interactPage();
  assert.deepEqual(await setChecked(p, "#terms", true), { ok: true });
  assert.equal(await p.isChecked("#terms"), true);
  assert.deepEqual(await setChecked(p, "#terms", true), { ok: true });
  assert.equal(await p.isChecked("#terms"), true);
  assert.deepEqual(await setChecked(p, "#terms", false), { ok: true });
  assert.equal(await p.isChecked("#terms"), false);
  assert.deepEqual(await setChecked(p, "#terms", false), { ok: true });
  assert.equal(await p.isChecked("#terms"), false);
  assert.deepEqual(await setChecked(p, "#agreed", false), { ok: true });
  assert.equal(await p.isChecked("#agreed"), false);
  assert.deepEqual(await setChecked(p, "#r1", true), { ok: true });
  assert.equal(await p.isChecked("#r1"), true);
});

test("setChecked fails clearly on a non-checkbox and on unchecking a radio (T019 AC8)", async () => {
  const p = await interactPage();
  const notBox = await setChecked(p, "#not-a-box", true);
  assert.equal(notBox.ok, false);
  assert.match(notBox.error ?? "", /not a checkbox or radio/i);
  await setChecked(p, "#r1", true);
  const radio = await setChecked(p, "#r1", false);
  assert.equal(radio.ok, false);
  assert.match(radio.error ?? "", /radio/i);
});

test("scroll brings an element into view, or pages down one viewport when omitted (T019 AC5)", async () => {
  const p = await interactPage();
  assert.equal(await p.evaluate("window.scrollY"), 0);
  assert.deepEqual(await scroll(p), { ok: true });
  const afterPage = (await p.evaluate("window.scrollY")) as number;
  assert.ok(afterPage > 0, `expected scrollY > 0, got ${afterPage}`);
  assert.deepEqual(await scroll(p, "#footer"), { ok: true });
  assert.equal(await p.evaluate("(() => { const r = document.getElementById('footer').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()"), true);
});

test("scroll on a non-scrollable page is ok (T019 edge)", async () => {
  await fixturePage.setContent("<p>short</p>", { waitUntil: "domcontentloaded" });
  assert.deepEqual(await scroll(fixturePage), { ok: true });
  assert.equal(await fixturePage.evaluate("window.scrollY"), 0);
});

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
