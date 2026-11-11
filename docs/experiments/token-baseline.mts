// Token baseline experiment: current ui_get_page_state vs compact+refs, on fixed flows.
// Pass 1 drives the real MCP server over stdio and records every request/reply.
// Pass 2 replays the same flows in-process to learn which elements are inside the viewport.
const ROOT = "/home/thunderkds/workspace/pets/easy-ui-mcp";
const { Client } = await import(`${ROOT}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { StdioClientTransport } = await import(`${ROOT}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`);
const { chromium } = await import(`${ROOT}/node_modules/playwright/index.mjs`);
const { getPageState } = await import(`${ROOT}/src/tools/web.ts`);
import fs from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname);
const RUN_DIR = path.join(OUT, "run");
fs.mkdirSync(RUN_DIR, { recursive: true });

type El = { role: string; name: string; selector: string; state?: Record<string, unknown> };
type Snap = { url?: string; title?: string; elements: El[]; overlays?: any[]; focused?: any; messages?: string[]; note?: string };
type Target = El | string; // element from a snapshot, or a raw CSS selector

interface Driver {
  start(label: string): Promise<void>;
  step(label: string): Promise<void>;
  nav(url: string): Promise<void>;
  snap(): Promise<El[]>;
  click(t: Target): Promise<void>;
  fill(t: Target, value: string): Promise<void>;
  press(key: string, t?: Target): Promise<void>;
  setChecked(t: Target, checked: boolean): Promise<void>;
  text(css: string): Promise<void>;
  assert(condition: string): Promise<void>;
  end(): Promise<void>;
}

function pick(els: El[], role: string, name: RegExp, nth = 0): El {
  const hits = els.filter((e) => e.role === role && name.test(e.name));
  if (!hits[nth]) throw new Error(`pick failed: ${role} ${name} nth=${nth} (${hits.length} hits of ${els.length})`);
  return hits[nth];
}

const FLOWS: Record<string, (d: Driver) => Promise<void>> = {
  "todomvc (small app)": async (d) => {
    await d.start("TodoMVC add and complete");
    await d.step("Open the app");
    await d.nav("https://demo.playwright.dev/todomvc/");
    let els = await d.snap();
    await d.step("Add three todos");
    const box = pick(els, "textbox", /needs to be done/i);
    for (const t of ["Buy milk", "Write report", "Call the bank"]) {
      await d.fill(box, t);
      await d.press("Enter", box);
    }
    els = await d.snap();
    await d.step("Complete the first and filter");
    await d.setChecked(pick(els, "checkbox", /Toggle Todo/i, 0), true);
    await d.click(pick(els, "link", /^Completed$/));
    els = await d.snap();
    await d.assert("document.querySelectorAll('.todo-list li').length === 1");
    await d.end();
  },
  "saucedemo (login + checkout)": async (d) => {
    await d.start("Saucedemo checkout");
    await d.step("Log in");
    await d.nav("https://www.saucedemo.com/");
    let els = await d.snap();
    await d.fill(pick(els, "textbox", /Username/i), "standard_user");
    await d.fill(pick(els, "textbox", /Password/i), "secret_sauce");
    await d.click(pick(els, "button", /Login/i));
    els = await d.snap();
    await d.step("Add two items and open the cart");
    await d.click(pick(els, "button", /Add to cart/i, 0));
    await d.click(pick(els, "button", /Add to cart/i, 1));
    await d.click(".shopping_cart_link");
    els = await d.snap();
    await d.step("Check out");
    await d.click(pick(els, "button", /Checkout/i));
    els = await d.snap();
    await d.fill(pick(els, "textbox", /First Name/i), "Ada");
    await d.fill(pick(els, "textbox", /Last Name/i), "Lovelace");
    await d.fill(pick(els, "textbox", /Zip|Postal/i), "10000");
    await d.click(pick(els, "button", /Continue/i));
    els = await d.snap();
    await d.click(pick(els, "button", /Finish/i));
    els = await d.snap();
    await d.assert("document.body.innerText.includes('Thank you for your order')");
    await d.end();
  },
  "wikipedia (long article)": async (d) => {
    await d.start("Wikipedia read and search");
    await d.step("Open an article");
    await d.nav("https://en.wikipedia.org/wiki/Playwright_(software)");
    let els = await d.snap();
    await d.step("Follow a link");
    await d.click(pick(els, "link", /^Microsoft$/));
    els = await d.snap();
    await d.text("h1");
    await d.step("Search");
    const search = els.find((e) => /searchbox|textbox|combobox/.test(e.role) && /Search Wikipedia/i.test(e.name));
    if (!search) throw new Error("no search box in snapshot");
    await d.fill(search, "Selenium (software)");
    await d.press("Enter", search);
    els = await d.snap();
    await d.assert("document.title.includes('Selenium')");
    await d.end();
  },
  "hacker news (link list)": async (d) => {
    await d.start("Hacker News browse");
    await d.step("Open the front page");
    await d.nav("https://news.ycombinator.com/");
    let els = await d.snap();
    await d.step("Newest, then past");
    await d.click(pick(els, "link", /^new$/));
    els = await d.snap();
    await d.click(pick(els, "link", /^past$/));
    els = await d.snap();
    await d.step("Open the first comment thread");
    await d.click(pick(els, "link", /\d+\s+comments?|discuss/i, 0));
    els = await d.snap();
    await d.assert("location.pathname === '/item'");
    await d.end();
  },
};

// ---------- compact rendering (the proposed format) ----------
function stateText(s?: Record<string, unknown>): string {
  if (!s) return "";
  return Object.entries(s)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}=${typeof v === "string" ? JSON.stringify(v) : v}`))
    .join("");
}
function compact(s: Snap, keep?: boolean[]): string {
  const lines = [`url: ${s.url}`, `title: ${s.title}`];
  s.elements.forEach((e, i) => {
    if (!keep || keep[i]) lines.push(`@e${i + 1} ${e.role} ${JSON.stringify(e.name)}${stateText(e.state)}`);
  });
  (s.overlays ?? []).forEach((o, i) => lines.push(`overlay @o${i + 1} ${o.role} ${JSON.stringify(o.name)}${o.modal ? " modal" : ""}`));
  if (s.focused) lines.push(`focused: ${s.focused.role} ${JSON.stringify(s.focused.name)}`);
  if (s.messages?.length) lines.push(`messages: ${s.messages.map((m) => JSON.stringify(m)).join(" | ")}`);
  if (s.note) lines.push(`note: ${s.note}`);
  return lines.join("\n");
}

// ---------- pass 1: real MCP server ----------
type Rec = { tool: string; args: Record<string, unknown>; reply: string; isError: boolean; snap?: Snap; ref?: string; refName?: string };

async function mcpDriver(): Promise<{ d: Driver; recs: Rec[]; close: () => Promise<void>; schemaChars: number }> {
  const transport = new StdioClientTransport({
    command: `${ROOT}/node_modules/.bin/tsx`,
    args: [`${ROOT}/src/stdio.ts`],
    cwd: RUN_DIR,
    stderr: "ignore",
  });
  const client = new Client({ name: "token-experiment", version: "0" });
  await client.connect(transport);
  const schemaChars = JSON.stringify((await client.listTools()).tools).length;
  const recs: Rec[] = [];
  let last: El[] = [];
  const call = async (tool: string, args: Record<string, unknown>, t?: Target): Promise<Rec> => {
    const res: any = await client.callTool({ name: tool, arguments: args });
    const reply = (res.content ?? []).map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
    const rec: Rec = { tool, args, reply, isError: !!res.isError };
    if (t && typeof t !== "string") {
      rec.ref = `@e${last.indexOf(t) + 1}`;
      rec.refName = `${t.role} ${JSON.stringify(t.name)}`;
    }
    recs.push(rec);
    if (res.isError) throw new Error(`${tool} failed: ${reply.slice(0, 200)}`);
    return rec;
  };
  const sel = (t: Target) => (typeof t === "string" ? t : t.selector);
  const d: Driver = {
    start: async (label) => void (await call("ui_start_session", { target: label })),
    step: async (label) => void (await call("ui_step", { label })),
    nav: async (url) => void (await call("ui_navigate", { url })),
    snap: async () => {
      await new Promise((r) => setTimeout(r, 800)); // client-side settle, costs no tokens
      const rec = await call("ui_get_page_state", {});
      rec.snap = JSON.parse(rec.reply);
      last = rec.snap!.elements ?? [];
      rec.snap!.elements = last;
      return last;
    },
    click: async (t) => void (await call("ui_click", { selector: sel(t) }, t)),
    fill: async (t, value) => void (await call("ui_fill", { selector: sel(t), value }, t)),
    press: async (key, t) => void (await call("ui_press_key", t ? { key, selector: sel(t) } : { key }, t)),
    setChecked: async (t, checked) => void (await call("ui_set_checked", { selector: sel(t), checked }, t)),
    text: async (css) => void (await call("ui_get_text", { selector: css })),
    assert: async (condition) => void (await call("ui_assert", { condition })),
    end: async () => void (await call("ui_end_session", {})),
  };
  return { d, recs, close: () => client.close(), schemaChars };
}

// ---------- pass 2: in-process, viewport membership ----------
type VSnap = { total: number; inView: number; compactAll: number; compactInView: number };
async function viewportPass(flow: (d: Driver) => Promise<void>) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const snaps: VSnap[] = [];
  let targets = 0;
  let targetsOffscreen = 0;
  let last: El[] = [];
  let lastKeep: boolean[] = [];
  const loc = (t: Target) => page.locator(typeof t === "string" ? t : t.selector);
  const settle = () => page.waitForLoadState("domcontentloaded").catch(() => {});
  const note = (t: Target) => {
    if (typeof t === "string") return;
    targets++;
    if (!lastKeep[last.indexOf(t)]) targetsOffscreen++;
  };
  const d: Driver = {
    start: async () => {},
    step: async () => {},
    end: async () => {},
    assert: async () => {},
    text: async () => {},
    nav: async (url) => void (await page.goto(url, { waitUntil: "domcontentloaded" })),
    snap: async () => {
      await page.waitForTimeout(600);
      const s = (await getPageState(page)) as Snap;
      last = s.elements ?? [];
      s.elements = last;
      lastKeep = [];
      for (const e of last) {
        lastKeep.push(
          await page
            .locator(e.selector)
            .evaluate((el: Element) => {
              const r = el.getBoundingClientRect();
              return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
            }, undefined, { timeout: 2000 })
            .catch(() => false)
        );
      }
      snaps.push({
        total: last.length,
        inView: lastKeep.filter(Boolean).length,
        compactAll: compact(s).length,
        compactInView: compact(s, lastKeep).length,
      });
      return last;
    },
    click: async (t) => { note(t); await loc(t).click(); await settle(); },
    fill: async (t, v) => { note(t); await loc(t).fill(v); },
    press: async (key, t) => { if (t) await loc(t).press(key); else await page.keyboard.press(key); await settle(); },
    setChecked: async (t, c) => { note(t); await loc(t).setChecked(c); },
  };
  let error: string | undefined;
  try { await flow(d); } catch (e) { error = String(e).slice(0, 200); }
  await browser.close();
  return { snaps, targets, targetsOffscreen, error };
}

// ---------- accounting ----------
const tok = (chars: number) => Math.round(chars / 4);
function account(recs: Rec[]) {
  let reqA = 0, reqB = 0, snapA = 0, snapB = 0, otherA = 0, otherB = 0, otherMin = 0;
  const turnsA: number[] = [], turnsB: number[] = [];
  for (const r of recs) {
    const a = JSON.stringify({ name: r.tool, arguments: r.args }).length;
    const bArgs = r.ref ? { ...r.args, selector: r.ref } : r.args;
    const b = JSON.stringify({ name: r.tool, arguments: bArgs }).length;
    reqA += a; reqB += b;
    let ra = r.reply.length, rb = ra;
    if (r.snap) {
      rb = compact(r.snap).length;
      snapA += ra; snapB += rb;
    } else {
      // With refs the echo names the element instead of repeating its selector.
      if (r.ref && typeof r.args.selector === "string") rb = r.reply.split(r.args.selector as string).join(r.refName!).length;
      otherA += ra; otherB += rb;
      otherMin += r.isError ? ra : '{"ok":true}'.length;
    }
    turnsA.push(a + ra); turnsB.push(b + rb);
  }
  // Uncached re-read: every turn the model reads the whole transcript so far.
  const cumulative = (turns: number[]) => turns.reduce((sum, _t, i) => sum + turns.slice(0, i + 1).reduce((x, y) => x + y, 0), 0);
  return {
    calls: recs.length,
    snapshots: recs.filter((r) => r.snap).length,
    A: { requests: tok(reqA), snapshots: tok(snapA), otherReplies: tok(otherA), total: tok(reqA + snapA + otherA), cumulative: tok(cumulative(turnsA)) },
    B: { requests: tok(reqB), snapshots: tok(snapB), otherReplies: tok(otherB), total: tok(reqB + snapB + otherB), cumulative: tok(cumulative(turnsB)) },
    minimalReplies: { otherReplies: tok(otherMin), saved: tok(otherA - otherMin) },
    perSnapshot: recs.filter((r) => r.snap).map((r) => ({
      url: r.snap!.url, elements: r.snap!.elements.length, capped: !!r.snap!.note,
      current: tok(r.reply.length), compact: tok(compact(r.snap!).length),
      duplicateLines: r.snap!.elements.length - new Set(r.snap!.elements.map((e) => `${e.role}|${e.name}`)).size,
    })),
  };
}

const only = process.argv[2];
const results: Record<string, unknown> = {};
let schemaChars = 0;
for (const [name, flow] of Object.entries(FLOWS)) {
  if (only && !name.includes(only)) continue;
  const m = await mcpDriver();
  schemaChars = m.schemaChars;
  let error: string | undefined;
  try { await flow(m.d); } catch (e) { error = String(e).slice(0, 300); }
  await m.close().catch(() => {});
  const viewport = await viewportPass(flow);
  results[name] = { error, ...account(m.recs), viewport, sampleReplies: m.recs.filter((r) => !r.snap).slice(0, 40).map((r) => `${r.tool}: ${r.reply.slice(0, 160)}`) };
  console.error(`done: ${name}${error ? " ERROR " + error : ""}${viewport.error ? " VIEWPORT-ERROR " + viewport.error : ""}`);
}
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ schemaTokens: tok(schemaChars), results }, null, 1));
console.log("schema tokens", tok(schemaChars));
for (const [name, r] of Object.entries(results) as [string, any][]) {
  console.log(`\n== ${name}: ${r.calls} calls, ${r.snapshots} snapshots${r.error ? " ERROR " + r.error : ""}`);
  console.log(" A current      ", JSON.stringify(r.A));
  console.log(" B compact+refs ", JSON.stringify(r.B));
  console.log(" minimal replies", JSON.stringify(r.minimalReplies));
  console.log(" snapshots      ", JSON.stringify(r.perSnapshot));
  console.log(" viewport       ", JSON.stringify(r.viewport));
}
