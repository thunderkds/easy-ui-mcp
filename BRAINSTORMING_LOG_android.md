# BRAINSTORMING_LOG.md
**Generated**: 2026-07-09
**Task / Context**: v2 milestone — Android native app testing via Appium
**Skill**: `Skill({ skill: "brainstorming" })`

---

## The Problem Space

`easy-ui-mcp` currently exposes 8 `ui_*` MCP tools that drive a single Chromium instance via Playwright, inside a container built from `mcr.microsoft.com/playwright`. `PROJECT_SPEC.md`'s Critical Constraints explicitly deferred mobile/native automation ("Web only for v1 — `src/tools/mobile.ts` stays a stub; no Appium/Maestro integration until v2"). We are now doing that v2 work.

The core challenge is **not** "how do we call Appium" — WebdriverIO/Appium clients are well-documented. The real challenge is architectural fit inside a design that was built around a single in-process browser lifecycle:

1. **Two automation runtimes, one MCP process.** Playwright (`browser`/`page`, in-process) and Appium (a separate WebDriver *server* the MCP process must spawn, health-check, and tear down) now coexist. The existing `resolvePageForWrite`/`resolvePageForRead`/session-bracket model (`activeSessionId`, `ui_start_session`/`ui_end_session`) was designed for one page at a time — a second driver type means either parallel session state per-protocol, or a shared abstraction that has to support both without leaking Playwright-specific assumptions (`Page` object, CSS selectors) into the Android tools.
2. **The device lives outside the container.** User confirmed: Appium targets an external emulator/device reached over ADB (host or LAN), not one bundled in the image. This means the container needs `adb` binaries and TCP reachability to the host's ADB server (`adb connect <host>:5555` or similar) — a new *runtime* dependency the current Dockerfile has zero provision for, and a new failure mode (device unreachable) that has no analogue in the Playwright tools today.
3. **Appium is spawned as a child process.** User confirmed this should mirror the current `browser` singleton pattern in `server.ts` (started once, reused, torn down on `SIGTERM`). Unlike `chromium.launch()`, `appium` is an external CLI/npm binary the MCP server has to shell out to and manage as an OS process (start, wait-for-ready on its HTTP port, kill on shutdown) — a new category of process-lifecycle risk (zombie processes, port collisions, startup races) that doesn't exist in the current codebase.
4. **Selector semantics diverge entirely.** All 8 existing tools take a CSS `selector: string`. Native Android has no CSS DOM — locators are `resource-id`, `accessibility id`, `-android uiautomator`, or `xpath`. This is a hard boundary, not a detail: it decides whether `android_*` tools get their own input schema or try to shoehorn into the existing one (they must not — this is called out explicitly below).

**Non-negotiable constraints carried forward from `PROJECT_SPEC.md`:**
- No server-side LLM calls / API keys in the container.
- Existing `ui_*` tools, their session/report model, and Chromium-only behavior must not regress.
- Must still start via `docker-compose up -d` as the primary UX (per NFR-001 / Docker↔Claude Code connectivity being a locked success metric).

---

## Questions for the User

Resolved during this session:
1. ~~Where does the Android device run?~~ → **External, reached over ADB** (host or LAN).
2. ~~Who manages the Appium server process?~~ → **MCP server spawns it as a child process**, mirroring the `browser` singleton.

Still open — deferred to Stage 2 planning, not blocking direction selection:
3. Which capability set does `android_start_session` require from the caller — a pre-installed `appPackage`/`appActivity` (app already on device) vs. an `.apk` path to install fresh each session? (Affects `android_start_session`'s input schema — small, non-architectural.)
4. Does `adb` ship inside the container image (added to Dockerfile) or is the container expected to reach a host-side `adb server` over TCP with no `adb` binary of its own? (Affects Dockerfile scope in Stage 2 — flagged in Surgical Scope below, not a fork between the three paths.)

---

## Alternative Paths

| Option | Name | Summary | Invasiveness | Code Volume | Regression Risk | Recommended? |
|--------|------|---------|-------------|------------|----------------|--------------|
| A | Bolt-On Twin | Separate `android_*` tool set + separate `AndroidSession` module, no shared abstraction with Playwright tools | Low | ~350 lines | Low | |
| B | Unified Driver Abstraction | Introduce a `Driver` interface both Playwright and Appium session managers implement; `ui_*`/`android_*` tools call through it | High | ~550 lines (incl. Playwright refactor) | High | |
| C | Parallel Session Registry | Keep `ui_*` and `android_*` as fully separate tool families (like Option A), but unify only the *session bracket + report logging* layer (`tools/session.ts`) behind a small protocol-agnostic interface, since that layer is already driver-agnostic in spirit | Low–Medium | ~300 lines | Low | ✅ Yes |

### Option A — Bolt-On Twin
**Approach**: Add `src/tools/android.ts` (Appium primitives: tap/input/swipe/assert/screenshot/screen-state) and `src/tools/android-session.ts` (spawns Appium child process, manages WebDriver session, its own `activeAndroidSessionId`) as fully independent siblings to `web.ts`/`session.ts`. Register 8 new `android_*` tools in `server.ts` next to the existing 8, each with its own recording/report wiring duplicated from the `recordAction` pattern.
**Pros**: Zero risk to existing `ui_*` code path — literally does not touch `web.ts`, `session.ts`, or their call sites. Easiest to review and to revert independently. Fastest to ship a tracer-bullet slice (one Appium session + one tap tool, proven end-to-end).
**Cons**: Duplicates the session-bracket/report-writing logic (currently in `tools/session.ts` + `reports/index.ts`) a second time with copy-pasted structure. Two independent `activeSessionId`-style globals in `server.ts` — a caller could have a web session and an android session both open with no shared "one bracket at a time" invariant unless hand-coded twice.
**Why it might fail**: The duplication compounds — the next platform (iOS?) triples it. `reports/index.ts`'s HTML template was built assuming Playwright-shaped actions; if Android actions have different shapes (device serial, app package) the report writer needs conditional logic or its own duplicate, which is easy to forget and get inconsistent.

### Option B — Unified Driver Abstraction
**Approach**: Define a `Driver` interface (`navigate/click/fill/assert/getState/screenshot` — or a lower-level `locate/act` pair) that both a `PlaywrightDriver` and `AppiumDriver` implement. Refactor `web.ts`'s existing functions to be `PlaywrightDriver` methods. `server.ts` tools become thin dispatchers: `ui_click`/`android_tap` both call `driver.click(selector)` where `selector` is a tagged union (`{type: 'css', value}` vs `{type: 'resource-id', value}`).
**Pros**: Genuinely DRY — one session-bracket implementation, one report writer, one set of tools conceptually (if we also collapsed `ui_*`/`android_*` into a single tool set with a `platform` argument, code volume drops further).
**Cons**: Forces an abstraction over two automation models that don't actually share much beyond "click something, assert something." Chromium's CSS selectors, viewport concepts, and page navigation have no clean Android analogue (no "navigate to URL" for a native app — you launch/terminate). The interface either grows optional/platform-specific methods (defeating the point of unifying) or the abstraction leaks immediately.
**Why it might fail**: This is a rewrite of working, already-shipped v1 code (`web.ts`, `session.ts` are the load-bearing modules from the completed T001–T005 milestone) to accommodate a feature that hasn't shipped yet. Violates Surgical Changes ("do not improve adjacent code") and Simplicity First — the abstraction is being built for a *hypothetical* future third platform, not the concrete Android requirement in front of us. High regression risk to the already-verified NFR-001 Docker↔Claude Code connectivity path for zero proven benefit yet.

### Option C — Parallel Session Registry
**Approach**: Like Option A, `android.ts` and Appium-specific tools stay fully separate from `web.ts`. But `tools/session.ts`'s `SessionRecord`/`LoggedAction`/`logAction`/`markFailed` types are already driver-agnostic (they store `{timestamp, action, args, ok, detail}` — no Playwright-specific fields) — extend `startSession(target, kind: 'web' | 'android')` to carry a `kind` discriminant and, on `'android'`, store an `AppiumSessionHandle` (webdriver client + device serial) instead of a `Page`. `getSessionPage`/`getSessionAndroidClient` become kind-checked accessors. One `activeSessionId` variable in `server.ts` still enforces "one bracket at a time" naturally, since it's the same registry. `reports/index.ts` gets one small conditional (render device serial vs. URL in the header) rather than a parallel writer.
**Pros**: Reuses the one piece of infrastructure that's already abstract enough to reuse honestly (session bracketing + report generation) without forcing Playwright/Appium action semantics together. New Android tools are still fully separate functions with their own resource-id-based schema — no leaky interface. Naturally enforces single-active-session-per-connection across both platforms, matching the existing UX ("call ui_end_session first" error) instead of introducing a second silent global.
**Why it might fail**: `startSession`'s current signature takes a `target: string` (URL-shaped). Repurposing it for a `kind` discriminant is a real (if small) signature change to code from the shipped milestone — needs the existing `web.test.ts`/`session.test.ts` to stay green as a hard gate, not just "probably fine." If Appium's WebDriver session setup fails partway (device connects but app launch times out), the session/report layer needs a clear partial-failure story, same as `markFailed`'s screenshot-on-failure today does for web — but no screenshot equivalent for a not-yet-launched app.

---

## 50% Rule Check

Applied to Option C (recommended): the *tools* themselves (tap/input/swipe/assert/screen-state/screenshot) can't shrink further — they're already one primitive each, matching the existing `ui_*` granularity the user has already validated. The 50%-less-code lever here is **not adding a new report writer or a new session-tracking module** — reusing `tools/session.ts` and `reports/index.ts` with a `kind` discriminant instead of Option A's full duplication is exactly this check paying off: it's the difference between ~300 lines and something closer to Option A's ~350 plus whatever a second report path would cost as the feature grows.

---

## Recommended Path

**Option C — Parallel Session Registry**

It's the only option that doesn't force a false choice between "duplicate everything" (A) and "unify things that shouldn't be unified" (B). It respects Surgical Changes by leaving `web.ts` completely untouched and only extending — not rewriting — `session.ts`'s already-generic session/report types with a discriminant, which is the minimum change needed to avoid duplicating session bracketing and report generation. It also directly satisfies the "one bracket at a time" UX the user already has for `ui_*` sessions, extended naturally to `android_*` sessions, without inventing a second global.

---

## Surgical Scope

Files that **should** be touched:
- `src/tools/session.ts` — extend `SessionRecord`/`startSession` with a `kind: 'web' | 'android'` discriminant and an Appium-side handle type; existing web-session behavior must be a no-op-equivalent when `kind: 'web'` is the (explicit or defaulted) value.
- `src/reports/index.ts` — small conditional in report rendering for android-kind sessions (device serial / app package instead of URL/title).
- `src/server.ts` — register the new `android_*` tools; existing `ui_*` tool registrations and the shared-`page` fallback path must be untouched.
- `Dockerfile` — add `adb` (Android platform-tools) to the image; do **not** add an AVD/emulator or Android SDK build-tools (out of scope per the external-device decision).
- `package.json` — add an Appium client dependency (WebdriverIO or `webdriver` package) and the `appium` server package.
- New: `src/tools/android.ts` (Appium primitives), `src/tools/android-session.ts` (Appium child-process + WebDriver session lifecycle).

Files that **must not** be touched:
- `src/tools/web.ts` — zero Playwright/CSS-selector logic should change; this is the already-verified v1 surface.
- `src/api/run-test.ts` — REST wrapper stays web-only for this milestone unless the user explicitly asks to extend it (not requested).
- `.claude/agents/`, `.claude/skills/`, `templates/`, `memory/` — Supervisor framework scaffolding per existing Critical Constraints.
- `test/web.test.ts`, `test/session.test.ts` — must stay green unmodified in behavior (session.ts changes are additive/discriminant-based, not a signature break for existing callers).

---

## Edge Case Checklist for TASK_GUIDE

- [ ] ADB target unreachable at `android_start_session` time (host/LAN device not connected) — must return a clear `isError` result, not hang or crash the process.
- [ ] Appium child process fails to start (port already bound, binary missing from image) — server must not silently fall back to a broken state; `android_start_session` should fail fast with the underlying error.
- [ ] Appium child process becomes a zombie on ungraceful MCP shutdown (crash, not just `SIGTERM`) — verify the existing `SIGTERM` handler pattern extends to killing the Appium child, and consider a startup check that kills any stale Appium process on a known port.
- [ ] `android_start_session` called while a `ui_*` (web) session is already active on the same connection, and vice versa — the "one bracket at a time" registry must reject the second with the same clear error style as today's `ui_start_session` collision check.
- [ ] App launch succeeds at the Appium/session level but the target Activity never becomes visible (app crash on launch) — `markFailed`-equivalent behavior needed; screenshot-on-failure may not be meaningful if no UI ever rendered, so `android_*` failure capture needs its own definition of "best-effort evidence," not a blind port of `takeScreenshot`.
- [ ] Selector ambiguity: a `resource-id`/`accessibility id` matching multiple elements — decide fail-fast (error, matching current `ui_click`'s "single element" semantics) vs. first-match, and document which.
- [ ] Device disconnects mid-session (USB unplug / LAN drop) — subsequent `android_tap`/`android_assert` calls must surface a distinct "device lost" error, not a generic timeout that looks like a locator failure.
- [ ] Concurrent MCP connections both targeting the same physical device/emulator over ADB — no coordination exists today for this; at minimum it should fail loudly rather than silently interleave actions on one device.

---

## Next Actions

1. Stage 2 `/plan`: break Option C into tracer-bullet tasks — first slice should be `android_start_session` + `android_tap` + `android_end_session` only (mirrors T001's "prove the pipe end-to-end" scope), before adding swipe/assert/screen-state/screenshot in later slices.
2. Resolve open Questions #3 (app install-fresh vs. pre-installed) and #4 (adb bundling approach) as part of writing the first TASK_GUIDE — both are schema/Dockerfile details, not direction-level blockers.
3. Update `PROJECT_SPEC.md` Critical Constraints: replace "Web only for v1 — no Appium/Maestro integration until v2" with the now-locked v2 scope (external device via ADB, Appium spawned as child process, Option C session model) once this direction is approved.
4. Common-Infrastructure-Agent should own the Dockerfile `adb` addition and the Appium npm dependency wiring as its own early task, since it's infra setup analogous to the original Playwright base-image work.

---

## User Selection

> **Approved direction**: Option C — Parallel Session Registry
> Approved by user on 2026-07-09.
