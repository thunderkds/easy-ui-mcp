# easy-ui-mcp

A Dockerized MCP (Model Context Protocol) server for local UI testing. It exposes Playwright-based browser automation tools over HTTP/SSE so an AI agent (like Claude Code) can drive web UI flows step-by-step and get back a JSON + HTML report with screenshots — no server-side LLM, no test scripts to write.

A static docs page for this project lives in [`site/index.html`](site/index.html); it deploys to Vercel as plain static files (no install, no build — see `vercel.json`).

## Quick Start

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

## Networking

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

## Tools

`ui_start_session`, `ui_end_session`, `ui_step`, `ui_navigate`, `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked`, `ui_scroll`, `ui_set_viewport`, `ui_type`, `ui_navigate_history`, `ui_click_outside`, `ui_dialog`, `ui_assert`, `ui_check`, `ui_wait_for`, `ui_get_page_state`, `ui_get_text`, `ui_take_screenshot` — plus a REST wrapper at `POST /api/run-test` for non-MCP callers.

### Run several sessions side by side

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

### Label your steps

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

### Close overlays and answer dialogs

- **Click outside.** `ui_click_outside(selector)` clicks just outside the element you name (pass the modal panel, not the backdrop) and says what it hit, the way a user dismisses a modal by clicking its backdrop. If nothing safe exists around it, it fails and suggests `ui_press_key` with `Escape`.
- **Click options.** `ui_click` also takes optional `button` (`right` fires `contextmenu`), `clickCount` (2 = double-click), `modifiers` (e.g. `["Shift"]`), `position` (offset inside the element) and `force` (click through a covering element). Without them it is a plain left click.
- **Native dialogs.** A browser `alert`/`confirm`/`prompt`/`beforeunload` blocks the page, so the server holds it open and asks you. The call that opened it returns at once with `Browser is waiting on a confirm dialog: "Delete?"`. Every other tool is refused until you answer with `ui_dialog` (`accept` or `dismiss`, plus `text` for a prompt); its reply tells you what the interrupted action did next. Calling `ui_dialog` when nothing is waiting pre-sets the answer for the next dialog, which is then answered without pausing (use it in scripted flows). A dialog left unanswered for `DIALOG_TIMEOUT_MS` (default 120000) is dismissed and the next response says so. Every dialog is logged in the report with who answered it.

### Use the selector from page state

`ui_get_page_state` returns the URL, title, up to 200 visible interactive elements as `{role, name, selector}`, and `messages` (visible alert/status text such as validation errors). Each `selector` is checked against the live page before it is returned, so pass it **unchanged** to `ui_click`, `ui_fill`, `ui_select_option`, `ui_press_key`, `ui_hover`, `ui_set_checked` and `ui_scroll` rather than guessing a CSS selector. A selector containing `nth=` is positional: call `ui_get_page_state` again after the page changes before reusing it.

```
{"role": "button", "name": "Sign in", "selector": "[data-testid=\"signin\"]"}
ui_click  selector: [data-testid="signin"]
```

Page state also tells you what the page looks like right now, so you do not have to guess:

- Each element may carry a `state` with only its non-default fields: `disabled`, `checked` (`true`, `false` or `"mixed"`), `value` (inputs, textarea, select; cut at 100 characters; **never** returned for a password field), `expanded`, `selected`, `pressed`, `required`, `invalid`.
- Custom widgets are listed too: `combobox`, `listbox`, `option`, `switch`, `slider`, `spinbutton`, `searchbox`, `treeitem`, `menuitemcheckbox`/`menuitemradio`, `summary`, `contenteditable` regions, and anything with a role and `tabindex >= 0`.
- `overlays` lists each open dialog as `{role, name, selector, modal}`, topmost first (`role=dialog`, `alertdialog`, `dialog[open]`, `aria-modal`). The key is absent when nothing is open, so a modal opening or closing shows up as the key appearing or disappearing.
- `focused` is `{role, name, selector}` for the element holding focus. It is absent when focus is on the page body, in an iframe or in a shadow root.

`ui_get_text` reads text: the trimmed visible text of one element (`selector`), or of the whole page body with no selector, cut at 4000 characters with a note of the real length. Use it to check a total, a heading or a field error. It fails on 0 or more than 1 match, like `ui_click`, and on an element that is not visible. The text it reads is returned to you but not stored in the report.
### Test at real sizes, type like a user, see what you capture

- **Sizes and settings.** `ui_start_session` takes optional `device` (a Playwright device name such as `"iPhone 13"`: mobile user agent, touch, pixel ratio, size), `viewport` `{width, height}` (overrides the device size), `colorScheme` (`light`/`dark`), `locale` and `timezoneId`. An unknown device is an error that lists valid names. With none of them the browser is a 1280x720 desktop. These apply to the session only (not to the shared page used without a session). `ui_set_viewport(width, height)` resizes mid-flow (320-3840 x 320-2160); layouts can change, so call `ui_get_page_state` again afterwards. The settings appear in the report header.
- **Typing.** `ui_fill` sets the whole value at once. `ui_type(selector, text, delayMs?)` types key by key (`keydown`/`input`/`keyup` per character, appended to what is there), for autocomplete, search-as-you-type, masked inputs and OTP boxes. The report's step line only says how many characters were typed. The text itself is replaced by `••••` (in the reply and the stored step) when the target is a password, one-time-code or card-number (`autocomplete`) field, or uses `-webkit-text-security`.
- **History.** `ui_navigate_history(action)` with `back`, `forward` or `reload` keeps the history and form state that a second `ui_navigate` would lose. With no entry to go to, it is an error that says so.
- **Scrolling.** `ui_scroll` also takes `container` (the selector of a scroll area such as a chat panel, virtual table or carousel) and `direction` (`down`, `up`, `left`, `right`, `top`, `bottom`; default `down`). It moves one viewport (or container) step per call and says when the end was reached, so a loop over a lazy list knows when to stop.
- **Screenshots.** `ui_take_screenshot` also takes `selector` (just that element), `fullPage` (the whole page, cut at 16000 device pixels tall and 3840px wide) and `inline: true`, which returns the PNG as image content (scaled to fit 1280x8000px) as well as writing it to `reports/`.

### Verifying vs waiting — pick the right one

A session is marked `failed` if any hard action fails, so *how* you verify decides whether the report tells the truth.

| Tool | Condition false means | Use it for |
|------|----------------------|------------|
| `ui_assert` | **The session fails.** | A claim about the app: "the toggle is now on" |
| `ui_check` | Recorded and shown, run continues | An observation you want in the report but which should not condemn the run |
| `ui_wait_for` | Keeps polling; **timing out fails the session** | Waiting for the page to render or settle |

Never call `ui_assert` in a retry loop to wait for something — the first false result permanently fails the run even if the app is fine. That is what `ui_wait_for` is for.

For both `ui_check` and `ui_wait_for`, a condition that cannot *run* (no page open, or the expression throws) is always a hard failure: that is a harness error, not an observation.

Auto-failure screenshots are budgeted per session (`FAILURE_SCREENSHOT_BUDGET`, default 3). Identical screenshot content is embedded in the HTML report only once.

### What the report shows

A verdict box (status, target, step/action/failure counts, duration), then the run as labelled steps with per-step outcomes and elapsed time, then any browser problems, and finally the raw action log collapsed behind a disclosure.

Console errors, uncaught page errors, and network-level request failures are captured automatically and listed under **Browser problems** — a flow that passes while the console throws is a false green worth seeing. HTTP error responses such as 404 or 500 do not trigger Playwright's `requestfailed` event and are not listed automatically. Captured problems are informational and never change the verdict. Up to 50 are retained per session; past that the report says the rest were dropped.

Reports are named `session-<YYYYMMDD-HHMMSS>-<slug>-<id8>.{json,html}`: the UTC start time, a readable slug of the session target, and the first 8 characters of the session id. `reports/index.html` lists the sessions (newest first, capped at 500 — older reports stay on disk, unlisted) and is rewritten after every report.

See [AGENTS.md](AGENTS.md) for the architecture and full MCP connection guide, and [HARNESS.md](HARNESS.md) for the REST API reference. Deploy/rollback procedures are in [RUNBOOK.md](RUNBOOK.md).

## Scope (v1)

Web only (Chromium), local only, no mobile support yet. See [PRD.md](PRD.md) for full product intent and [PROJECT_SPEC.md](PROJECT_SPEC.md) for architecture decisions.
