import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { navigate } from "../src/tools/web.js";

let browser: Browser;
let page: Page;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
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
