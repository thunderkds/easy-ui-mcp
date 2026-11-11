# EASY UI MCP

**Not just another browser controller — a local UI-testing MCP that gives your agent structured, shareable test reports.**

easy-ui-mcp is a Dockerized MCP (Model Context Protocol) server for local UI testing. It exposes Playwright-based browser tools over HTTP/SSE so an AI agent (like Claude Code) can drive web UI flows step-by-step and get back a JSON + HTML report with screenshots — no server-side LLM, no test scripts to write.

A static docs page for this project lives in [`site/index.html`](https://easy-ui-mcp.vercel.app/); it deploys to Vercel as plain static files (no install, no build — see `vercel.json`).

## Highlights

General browser automation answers "can the agent click this?". easy-ui-mcp answers "did the flow work, and where is the proof?". It is built for testing and for evidence.

| What you get | How it works |
|---|---|
| **A report for every session** | Each session writes a JSON file and a self-contained HTML report: screenshots, step labels, pass/fail, and the action log. `reports/index.html` lists them all. See [What the report shows](#what-the-report-shows). |
| **Primitives made for testing** | `ui_start_session` / `ui_end_session` bracket a run. `ui_step(label)` names each stage. `ui_assert`, `ui_check` and `ui_wait_for` are three different tools on purpose: see [Verifying vs waiting](#verifying-vs-waiting--pick-the-right-one). |
| **A verdict you can trust** | A hard failure fails the session. A soft `ui_check` is recorded and the run continues. Console errors, page errors, failed requests and HTTP 4xx/5xx are listed under **Browser problems**, so a green run cannot hide a throwing console. |
| **Local-first, one command** | `docker compose up -d --build`. No cloud account, no API key, nothing leaves your machine. |
| **No LLM inside the server** | The server only runs tools and records the result. The agent does the reasoning, so cost and behaviour stay predictable. |
| **Made for Claude Code** | Register it over HTTP/SSE with one `claude mcp add`. One connection can run up to 3 sessions side by side, for example staging and production. A stdio entry (`dist/stdio.js`) serves hosts that wrap stdio servers. |
| **Fewer wasted calls** | `ui_get_page_state` returns one short line per element with a ref that is checked against the live page when you use it, plus element state, open dialogs and focus. Native `alert`/`confirm`/`prompt` dialogs are held open for the agent to answer. |

Report size was measured too: a soft-check run went from 357 KB to about 4 KB once soft failures stopped capturing a full-screen PNG. See [Measured](site/index.html#measured) on the docs page.

### Quick Start

```bash
docker compose up -d --build
curl http://localhost:8765/health
# {"status":"ok"}
```

Connect Claude Code:

```bash
claude mcp add --transport http easy-ui-mcp http://localhost:8765/mcp
```

Then ask Claude Code to navigate to a page and take a screenshot — it will call the tools below and report back.

**Using this from another repo?** MCP registration is per-project — run `claude mcp add` from that repo's root too (the container above only needs to run once, shared across repos). See [AGENTS.md → Using easy-ui-mcp From Another Repo](AGENTS.md#using-easy-ui-mcp-from-another-repo) for the full required steps.

## How it works in detail

Reference for each part of the server: transports, networking, every tool, sessions, reports and scope.

### Running over stdio (Glama, `mcp-proxy`)

Hosts that wrap a stdio MCP server, such as Glama's `mcp-proxy`, run `dist/stdio.js` instead of the HTTP server. It speaks the same tools over stdin/stdout, binds no port, and exits when stdin closes.

```bash
# build
pnpm install && pnpm build && pnpm exec playwright install --with-deps chromium
# start
mcp-proxy -- node dist/stdio.js
```

One stdio connection is one client, so the legacy shared page (the one `ui_navigate` uses without a session) is not shared with anyone else. The Docker/HTTP flow above is unchanged.

### Networking

The container runs with `network_mode: host` in `docker-compose.yml` (not a published port on a bridge
network). This is required, not optional: the browser Playwright drives inside this container needs to
reach `localhost:<port>` on **your host machine**, where the target app's dev server (the repo you're
testing) is actually running. A default bridge network gives the container its own isolated network
namespace with no route back to the host at all — target URLs like `http://localhost:8766` will hang or
fail with `ERR_CONNECTION_REFUSED`, and `http://<host-LAN-IP>:8766` will just time out, even if the target
server is listening and reachable via `curl` from the host shell.

If you fork/redeploy this container anywhere `network_mode: host` isn't available (e.g. Docker Desktop on
macOS/Windows, where host networking support is limited or absent), use `host.docker.internal` as the
target hostname instead of `localhost` when calling `ui_navigate`, and add a `network_mode: host` fallback
of `extra_hosts: ["host.docker.internal:host-gateway"]` to `docker-compose.yml`.

### Tools

`ui_start_session`, `ui_end_session`, `ui_step`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_set_viewport`, `ui_type`, `ui_navigate_history`, `ui_click_outside`, `ui_dialog`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_get_page_state`, `ui_get_text`, `ui_get_logs`, `ui_tabs`, `ui_upload_file`, `ui_drag`, `ui_take_screenshot` — plus a REST wrapper at `POST /api/run-test` for non-MCP callers.

#### Run several sessions side by side

One connection can hold several open sessions (default cap 3, set `MAX_SESSIONS_PER_CONNECTION` to change it), for example to compare two URLs or a logged-in and a logged-out user. `ui_start_session` returns a session id; pass it as `session_id` to any other tool to choose the session it acts on. Each session has its own browser, page, step label and report.

```
ui_start_session  target: "staging"      -> Session <id-A> started ...
ui_start_session  target: "production"   -> Session <id-B> started ...
ui_navigate       url: ...  session_id: <id-A>
ui_navigate       url: ...  session_id: <id-B>
ui_end_session    session_id: <id-A>
ui_end_session    session_id: <id-B>
```

- With exactly one open session, `session_id` can be left out, as before.
- With several open, leaving it out is an error that lists the open ids, so a call never lands on the wrong page.
- A session is reachable only from the connection that started it. Another connection passing its id gets `Unknown session`.
- A session with no tool call for 10 minutes (`SESSION_TIMEOUT_MS`, in milliseconds) is closed automatically: its browser is shut down and its report is written with status `timed_out`. A call with that id then returns `Session <id> was closed after 10 min idle`. When a connection closes, every session it still owns is ended and reported.

#### Label your steps

`ui_step(label)` groups everything that follows it under a plain-language heading, until the next `ui_step`. The label is the report's **only caller-authored statement of intent**. The server uses deterministic templates such as “Opened …”, “Clicked …”, and “Filled …” for individual actions—no LLM runs inside the container—so an unlabelled session still renders readable action descriptions under one implicit group.

```
ui_start_session  target: "Account Access toggle smoke"
ui_step           label:  "Open the Settings page"
ui_navigate       ...
ui_wait_for       ...
ui_step           label:  "Turn Manual Invoice access on"
ui_click          ...
ui_assert         ...
ui_end_session
```

Sessions with no `ui_step` calls still render correctly, under a single implicit group.

#### Close overlays and answer dialogs

- **Click outside.** `ui_click_outside(selector)` clicks just outside the element you name (pass the modal panel, not the backdrop) and says what it hit, the way a user dismisses a modal by clicking its backdrop. If nothing safe exists around it, it fails and suggests `ui_press_key` with `Escape`.
- **Click options.** `ui_click` also takes optional `button` (`right` fires `contextmenu`), `clickCount` (2 = double-click), `modifiers` (e.g. `["Shift"]`), `position` (offset inside the element) and `force` (click through a covering element). Without them it is a plain left click.
- **Native dialogs.** A browser `alert`/`confirm`/`prompt`/`beforeunload` blocks the page, so the server holds it open and asks you. The call that opened it returns at once with `Browser is waiting on a confirm dialog: "Delete?"`. Every other tool is refused until you answer with `ui_dialog` (`accept` or `dismiss`, plus `text` for a prompt); its reply tells you what the interrupted action did next. Calling `ui_dialog` when nothing is waiting pre-sets the answer for the next dialog, which is then answered without pausing (use it in scripted flows). A dialog left unanswered for `DIALOG_TIMEOUT_MS` (default 120000) is dismissed and the next response says so. Every dialog is logged in the report with who answered it.

#### Use the refs from page state

`ui_get_page_state` returns the page as short text: a `url:` line, a `title:` line, then one line per visible interactive element (up to 200) as `@eN role "name"` followed by its non-default state, and `messages:` (visible alert/status text such as validation errors). Pass the ref as the `selector` of `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_get_text`, `ui_take_screenshot` and `ui_upload_file` (and as `from` / `to` of `ui_drag`, `container` of `ui_scroll`, `within` of `ui_get_page_state`) instead of guessing a CSS selector.

```
url: https://shop.example/login
title: Sign in
@e1 textbox "Email" required
@e2 button "Sign in" disabled
ui_click  selector: @e2
```

A ref means the latest snapshot of that page and nothing older. A compact snapshot does no selector work; the selector behind a ref is built and checked against the live page when you first use the ref. A ref follows the element that was listed: if that element is gone or replaced by a look-alike, the call fails with a message that names the ref and says to call `ui_get_page_state` again. It never acts on a different element, and nothing is clicked or typed. A ref from another session or tab, one used before any snapshot, and an unknown number fail the same way. Reports and the action log show the real selector of each successful action. A refused ref is listed as a soft failed step with the ref the agent tried; it does not fail the session or take a failure screenshot. CSS and Playwright selectors still work everywhere; elements without an accessible name are not listed, so reach those with a CSS selector.

`format: "full"` returns the earlier JSON instead: the elements as `{role, name, selector, state?}` with a selector checked against the live page, plus `overlays`, `focused` and `messages`. It has no refs, and taking it ends the refs of the previous snapshot. A selector containing `nth=` is positional: call `ui_get_page_state` again after the page changes before reusing it.

Page state also tells you what the page looks like right now, so you do not have to guess:

- An element line carries only its non-default state, as ` key` for `true` and ` key=value` otherwise: `disabled`, `checked` (`checked`, `checked=false` or `checked="mixed"`), `value="..."` (inputs, textarea, select; cut at 100 characters; **never** shown for a password field), `expanded`, `selected`, `pressed`, `required`, `invalid`. Names are quoted JSON strings, so a quote or a line break in a name cannot make a second line.
- Custom widgets are listed too: `combobox`, `listbox`, `option`, `switch`, `slider`, `spinbutton`, `searchbox`, `treeitem`, `menuitemcheckbox`/`menuitemradio`, `summary`, `contenteditable` regions, and anything with a role and `tabindex >= 0`.
- `overlay @o1 dialog "Confirm" modal` lists each open dialog, topmost first (`role=dialog`, `alertdialog`, `dialog[open]`, `aria-modal`); `@o1` is accepted wherever a selector is, for example by `ui_click_outside`. No overlay line means nothing is open, so a modal opening or closing shows up as the line appearing or disappearing.
- `focused: @e2` names the element holding focus (as `role "name"` when it is not in the list). It is absent when focus is on the page body, in an iframe or in a shadow root.
- `note:` appears when the list was cut at 200 elements (it then suggests `viewport` and `within`), or when you scoped the list and it left elements out.

To read less on a long page, scope the list. Both arguments are optional and off by default, so with neither the reply is exactly as described above.

- `viewport: true` lists only elements whose bounding box is at least partly on screen at the current scroll position.
- `within` (a selector or an `@eN` / `@oN` ref) lists only the elements inside that one element; it fails, listing nothing, if it matches no element or several. An element with nothing interactive inside gives an empty list, not an error.
- Pass both and an element must satisfy both. `overlays`, `focused` and `messages` are never scoped. Refs number the scoped list and work as usual.
- A scoped reply that left elements out says so, for example `note: Showing 37 of 180 elements (viewport only); scroll, or call without viewport, for the rest`. The 200-element cap applies after scoping, and its note can follow on the same line.

`ui_get_text` reads text: the trimmed visible text of one element (`selector`), or of the whole page body with no selector, cut at 4000 characters with a note of the real length. Use it to check a total, a heading or a field error. It fails on 0 or more than 1 match, like `ui_click`, and on an element that is not visible. The text it reads is returned to you but not stored in the report.
#### Test at real sizes, type like a user, see what you capture

- **Sizes and settings.** `ui_start_session` takes optional `device` (a Playwright device name such as `"iPhone 13"`: mobile user agent, touch, pixel ratio, size), `viewport` `{width, height}` (overrides the device size), `colorScheme` (`light`/`dark`), `locale` and `timezoneId`. An unknown device is an error that lists valid names. With none of them the browser is a 1280x720 desktop. These apply to the session only (not to the shared page used without a session). `ui_set_viewport(width, height)` resizes mid-flow (320-3840 x 320-2160); layouts can change, so call `ui_get_page_state` again afterwards. The settings appear in the report header.
- **Typing.** `ui_fill` sets the whole value at once. `ui_type(selector, text, delayMs?)` types key by key (`keydown`/`input`/`keyup` per character, appended to what is there), for autocomplete, search-as-you-type, masked inputs and OTP boxes. The report's step line only says how many characters were typed. The text itself is replaced by `••••` (in the reply and the stored step) when the target is a password, one-time-code or card-number (`autocomplete`) field, or uses `-webkit-text-security`.
- **History.** `ui_navigate_history(action)` with `back`, `forward` or `reload` keeps the history and form state that a second `ui_navigate` would lose. With no entry to go to, it is an error that says so.
- **Scrolling.** `ui_scroll` also takes `container` (the selector of a scroll area such as a chat panel, virtual table or carousel) and `direction` (`down`, `up`, `left`, `right`, `top`, `bottom`; default `down`). It moves one viewport (or container) step per call and says when the end was reached, so a loop over a lazy list knows when to stop.
- **Screenshots.** `ui_take_screenshot` also takes `selector` (just that element), `fullPage` (the whole page, cut at 16000 device pixels tall and 3840px wide) and `inline: true`, which returns the PNG as image content (scaled to fit 1280x8000px) as well as writing it to `reports/`.

#### Debug a flow and work across tabs

- **Logs.** `ui_get_logs` reads the browser problems captured so far: console errors, uncaught page errors, failed requests and HTTP 4xx/5xx responses (method and URL, never bodies or headers). `since: last` (default) returns only what is new since the previous call, `start` everything; `level: warning` adds console warnings. Repeats are grouped `×N`, 50 lines at most. Use it when an action seemed to do nothing.
- **Tabs.** A `target=_blank` link or `window.open` popup opens a tab the session tracks. The next response says `New tab opened: <url> (tab 2)` but does not switch to it. `ui_tabs` with `list`, `switch` (with `index`) or `close` moves between tabs, numbered from 1; every other tool acts on the current tab. The last tab cannot be closed.
- **Upload.** `ui_upload_file(selector)` uploads one built-in file, `default_draft.png` (a tiny PNG), to an `input[type=file]` (hidden ones work) or to the chooser a button or label opens. It takes no path, so no other file in the container can be sent to the site under test.
- **Drag.** `ui_drag(from, to)` drags one element onto another with real pointer events: HTML5 drag-and-drop lists, kanban cards and pointer-based sortables.
- **Downloads.** A download is saved to `reports/downloads/<session>/`, logged as an action and announced on the next response (`Downloaded: <name> (<bytes> bytes)`). A session keeps at most 20 downloads of up to 25 MB each; a download over either cap is discarded and the next response says so.

```
ui_click          selector: <link that opens a new tab>   -> ... New tab opened: <url> (tab 2)
ui_tabs           action: "switch"  index: 2
ui_get_logs       since: "start"
ui_tabs           action: "close"
```

Tabs, logs and downloads exist only inside a `ui_start_session` bracket and belong to one session: with several open, pass `session_id`, and a popup opened in one session is neither listed nor announced in another.

#### Verifying vs waiting — pick the right one

A session is marked `failed` if any hard action fails, so *how* you verify decides whether the report tells the truth.

| Tool | Condition false means | Use it for |
|------|----------------------|------------|
| `ui_assert` | **The session fails.** | A claim about the app: "the toggle is now on" |
| `ui_check` | Recorded and shown, run continues | An observation you want in the report but which should not condemn the run |
| `ui_wait_for` | Keeps polling; **timing out fails the session** | Waiting for the page to render or settle |

Never call `ui_assert` in a retry loop to wait for something — the first false result permanently fails the run even if the app is fine. That is what `ui_wait_for` is for.

For both `ui_check` and `ui_wait_for`, a condition that cannot *run* (no page open, or the expression throws) is always a hard failure: that is a harness error, not an observation.

Auto-failure screenshots are budgeted per session (`FAILURE_SCREENSHOT_BUDGET`, default 3). Identical screenshot content is embedded in the HTML report only once.

#### What the report shows

A verdict box (status, target, step/action/failure counts, duration), then the run as labelled steps with per-step outcomes and elapsed time, then any browser problems, and finally the raw action log collapsed behind a disclosure.

Console errors, uncaught page errors, and network-level request failures are captured automatically and listed under **Browser problems** — a flow that passes while the console throws is a false green worth seeing. HTTP 4xx/5xx responses (a 500 is a *successful* request to Playwright, so `requestfailed` never fires) are captured as `httperror` as `<status> <METHOD> <url>`, with the query string dropped because it may hold tokens. Bodies and headers are never captured. Captured problems are informational and never change the verdict. Up to 50 are retained per session; past that the report says the rest were dropped.

**Debugging mid-flow.** `ui_get_logs` reads these same captured problems while the flow runs; see [Debug a flow and work across tabs](#debug-a-flow-and-work-across-tabs).

Reports are named `session-<YYYYMMDD-HHMMSS>-<slug>-<id8>.{json,html}`: the UTC start time, a readable slug of the session target, and the first 8 characters of the session id. `reports/index.html` lists the sessions (newest first, capped at 500 — older reports stay on disk, unlisted) and is rewritten after every report.

See [AGENTS.md](AGENTS.md) for the architecture and full MCP connection guide, and [HARNESS.md](HARNESS.md) for the REST API reference. Deploy/rollback procedures are in [RUNBOOK.md](RUNBOOK.md).

### Scope (v1)

Web only (Chromium) and local only. The server runs over HTTP/SSE by default and over stdio through `dist/stdio.js` (see [Running over stdio](#running-over-stdio-glama-mcp-proxy)). Android (Appium) work is on hold: the infrastructure is in the image, but no `android_*` tools are registered. See [PRD.md](PRD.md) for full product intent and [PROJECT_SPEC.md](PROJECT_SPEC.md) for architecture decisions.
