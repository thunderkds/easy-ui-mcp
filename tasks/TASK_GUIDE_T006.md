# TASK_GUIDE — T006: Docker/infra — bundle adb, Appium deps, local-emulator connection guide
**Date**: 2026-07-09
**Complexity Level**: C1
**Risk Level**: Low
**Priority**: P0
**Assigned agent**: Common-Infrastructure-Agent
**Agent guide**: `.claude/agents/common-infrastructure.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read `memory/MEMORY.md`
3. Read this file completely
4. Read `.claude/agents/common-infrastructure.md`
5. Apply the C1 process from the Complexity matrix in `.claude/agents/general-agent-template.md`

---

## Requirement (Pillar 1 — Adapt the requirement)

Add the infrastructure needed for Appium/Android testing: bundle the `adb` binary and Appium server/WebDriver client dependencies, and document exactly how a developer connects the container to an Android emulator (AVD) running locally on their host machine — reusing the `network_mode: host` fix already applied for the v1 web-target reachability problem.

**Restated intent**:
> A developer running `docker-compose up -d` on this repo can, with a documented set of host-side steps, get the container's `adb` to see a locally running AVD emulator with zero manual port-forwarding on Linux — and has a documented fallback for Docker Desktop (Mac/Windows) where host networking doesn't share loopback the same way.

**Out of scope**:
- No AVD/emulator bundled inside the Docker image (Option C / brainstorming decision — see `BRAINSTORMING_LOG_android.md`).
- No Appium session code yet (that's T007) — this task only proves `adb devices` / Appium server binary reachability.
- No Android SDK build-tools or full SDK — only `platform-tools` (for `adb`).

**Requirement Refs**:
- FR-012: external device/emulator only, no bundled AVD.
- FR-013: documented local-emulator connection guide with host-networking mechanism + Docker Desktop fallback.

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [x] Restated intent confirmed to match the user's request
- [x] Domain terms align with `PROJECT_SPEC.md` glossary
- [x] Every Acceptance Criterion below traces to FR-012/FR-013
- [x] FR-012, FR-013 exist in `PRD.md` and are covered by the Acceptance Criteria below

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `Dockerfile` installs Android `platform-tools` (`adb`) without adding a full Android SDK or AVD | FR-012 |
| 2 | `package.json` includes an Appium server package and a WebDriver client package (e.g. `appium`, `webdriverio` or `webdriver`) as dependencies, pinned to specific versions (mirroring the existing Playwright version pin pattern) | FR-010/FR-011 (enabling) |
| 3 | With an AVD running on a Linux host and `network_mode: host` already set in `docker-compose.yml`, `docker compose exec <service> adb devices` lists the running emulator with no manual port-forwarding | FR-013 |
| 4 | `AGENTS.md` gains a new "Android / Local Emulator" section (parallel to the existing "Networking" section) documenting: AVD creation on host (not in container), starting the AVD, verifying via `adb devices` on host, verifying via `adb devices` inside the container, and the `adb connect host.docker.internal:5555` fallback for Docker Desktop | FR-013 |
| 5 | Existing `docker-compose.yml`/`Dockerfile` changes do not break the v1 web tools (Playwright/Chromium still installs and runs) | Non-regression |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | AVD running on host, `docker compose up -d --build` | `docker compose exec <service> adb devices` lists the emulator | Manual run, output pasted |
| 2 | No AVD running | `adb devices` inside container returns an empty device list (not an error/crash) | Manual run, output pasted |
| 3 | `docker compose up -d --build` after these changes | Container builds and `/health` still returns 200 (no regression to v1) | `curl http://localhost:8765/health` |

### Verification Command (exact, runnable)

```bash
docker compose up -d --build && curl -sf http://localhost:8765/health && docker compose exec easy-ui-mcp adb devices
```

### Evidence (filled by reviewer at Stage 4/5)

| Check | Result | Notes / output snippet |
|-------|--------|------------------------|
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☑ N/A (justified) | No automated test framework covers Docker/ADB connectivity (per Test Plan). Manual verification substitutes, per task's own Test Plan section. Verification command output pasted below covers AC #1/#2/#3. |
| Verification command run | ☑ pass | `docker compose up -d --build && curl -sf http://localhost:8765/health && docker compose exec easy-ui-mcp adb devices` → stdout: `{"status":"ok"}` then `List of devices attached` (empty list, no AVD present in this sandbox — exit code 0, no crash). Confirms AC #1 (adb present, image builds), AC #2 (empty-list-not-error), AC #5 (health still 200, no regression). |
| Negative cases hold | ☑ pass | No-AVD case (AC #2) verified directly above: `adb devices` returns empty device list, exit 0, no exception/crash — matches Success Criteria row #2. AC #3 (AVD-present happy path) could not be exercised in this sandbox — no Android emulator/AVD available in this environment. Documented as an environment limitation; `adb --version` confirms the binary itself works (`Android Debug Bridge version 1.0.41`, `Version 28.0.2-debian`, installed at `/usr/lib/android-sdk/platform-tools/adb`). |
| verify | ☑ pass | `Skill({ skill: "verify" })` equivalent: `docker compose up -d --build` succeeded, `/health` returned `{"status":"ok"}`, container did not crash/restart-loop after port conflict was resolved (see Notes below). |
| Review scope bounded to the change's blast radius | ☑ pass | Changes touch only `Dockerfile`, `package.json`, `package-lock.json`, `AGENTS.md` — no `src/` files touched, matching Files Must NOT Touch list. |
| Full smoke suite still green (no regression) | ☑ pass | `npm test` → `tests 27, pass 27, fail 0` (see full output pasted in Notes below). One transient false failure was diagnosed and resolved: an earlier `npm test` run left an orphaned `tsx src/server.ts` process bound to host port 8765 (host networking mode means the Docker container and `npm test`'s spawned server compete for the same host port); killing the orphan and rerunning gave a clean 27/27 pass. Not a regression introduced by this task. |
| UI: Visual regression | ☐ N/A | Pure-backend infra task |
| UI: Design-system compliance | ☐ N/A | Pure-backend infra task |
| UI: Responsiveness | ☐ N/A | Pure-backend infra task |

---

## UI / Design Acceptance Criteria

Deleted — pure-backend/infra task, no UI component. All three UI Evidence rows above marked N/A.

---

## Evidence Notes (raw output, pasted at Stage 4/5)

**Verification command, full output:**
```
$ docker compose up -d --build && curl -sf http://localhost:8765/health && docker compose exec easy-ui-mcp adb devices
...
 Image easy-ui-mcp-t006-easy-ui-mcp Built
 Container easy-ui-mcp-t006-easy-ui-mcp-1 Running
{"status":"ok"}List of devices attached

EXIT=0
```

**No-AVD negative case, isolated:**
```
$ curl -sf http://localhost:8765/health && docker compose exec easy-ui-mcp adb devices
{"status":"ok"}
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
```
(empty device list — no exception, no crash, exit 0)

**adb binary sanity check inside container:**
```
$ docker compose exec easy-ui-mcp adb --version
Android Debug Bridge version 1.0.41
Version 28.0.2-debian
Installed as /usr/lib/android-sdk/platform-tools/adb
```

**Full smoke suite (`npm test`), after resolving an orphaned-process port conflict (unrelated to this task's changes):**
```
✔ MCP initialize handshake succeeds and advertises ui_navigate (31.820045ms)
✔ full session happy path: start, log actions, end, JSON+HTML reports written in order (149.925123ms)
✔ mid-session failure: session stops, marked failed, screenshot captured, report still emitted (111.884185ms)
✔ two sessions started back-to-back get isolated browser contexts and reports (162.568962ms)
✔ session left open past its timeout is cleaned up (no leak, resource freed) (278.442784ms)
✔ ending an unknown/already-ended session returns undefined, not a crash (0.246279ms)
✔ navigate succeeds on a reachable page (257.244885ms)
✔ navigate fails clearly on an unreachable URL (no hang, no throw) (9.254708ms)
✔ navigate fails clearly on a malformed URL (3.051114ms)
✔ click succeeds on a unique selector match (101.158406ms)
✔ click fails clearly when selector matches 0 elements (5.468545ms)
✔ click fails clearly when selector matches >1 elements (no silent first-match click) (5.756416ms)
✔ fill succeeds on a unique input selector (18.517074ms)
✔ fill fails clearly when selector matches 0 elements (4.182554ms)
✔ fill fails clearly when selector matches >1 elements (4.694379ms)
✔ assertCondition returns passed:true for a true condition (4.847321ms)
✔ assertCondition returns passed:false for a false condition (3.582835ms)
✔ assertCondition fails clearly when no active page (no unhandled exception) (0.28459ms)
✔ getPageState returns URL, title, and visible interactive elements (31.75063ms)
✔ getPageState fails clearly when no active page (0.253289ms)
✔ takeScreenshot writes a PNG file to the output dir and returns its path (39.702336ms)
✔ takeScreenshot fails clearly when no active page (0.178994ms)
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

**Known limitation**: no Android emulator/AVD is available in this sandbox environment, so AC #3 (the AVD-present happy path where `adb devices` lists a running emulator) could not be exercised end-to-end here. `adb`'s presence, binary functionality (`adb --version`), and the no-AVD/empty-list negative case (AC #2) were verified directly. `network_mode: host` was already verified working for v1 web-target reachability (per `memory/decisions.md`), and the same host-networking mechanism applies uniformly to any TCP-based tool including ADB — this is a networking-layer guarantee, not something that differs between web ports and the ADB port. A developer with an actual AVD running on a Linux host should confirm AC #3 as a follow-up smoke check per the documented `AGENTS.md` steps.

---

## Approach

Extend the existing `Dockerfile` (based on `mcr.microsoft.com/playwright:v1.61.1-jammy`) with an `apt-get install` step for `android-tools-adb` (or equivalent `platform-tools` package for Debian/Ubuntu-based images), matching the comment style already in the Dockerfile ("Chromium only for v1 ... no manual browser install steps"). Add `appium` and a WebDriver client package to `package.json` as new dependencies (not devDependencies, since the server needs them at runtime), pinned to specific versions like `playwright: "1.61.1"` is today. Do not touch `network_mode: host` — it's already set; this task only verifies and documents it works for ADB too.

---

## Edge Case Checklist

- [ ] `network_mode: host` behaves differently or is unavailable on Docker Desktop (Mac/Windows) — the guide must call this out explicitly, not just document the Linux happy path.
- [ ] `adb devices` inside the container racing against the AVD still booting on the host — document that `adb wait-for-device` or a retry loop may be needed, don't assume instant availability.
- [ ] Multiple AVDs running on the host simultaneously — `adb devices` will show more than one; document that a specific device serial will be needed later (T007), not solved here.
- [ ] `adb` version mismatch between host and container causing protocol errors — pin a version and note this as a known failure mode.

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| `Dockerfile` | Add `adb`/platform-tools install step |
| `package.json` | Add `appium` + WebDriver client dependencies |
| `AGENTS.md` | New "Android / Local Emulator" section |
| `docker-compose.yml` | Verify only — likely no change needed since `network_mode: host` already applied |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `src/tools/web.ts` | Out of scope per `BRAINSTORMING_LOG_android.md` Surgical Scope — v1 web tools untouched |
| `src/tools/session.ts` | Session lifecycle changes belong to T007, not this infra task |
| `.claude/agents/`, `.claude/skills/`, `templates/`, `memory/` | Supervisor framework scaffolding |

---

## Test Plan

Manual verification only for this infra task (no automated test framework covers Docker/ADB connectivity): run the Verification Command above with an AVD running, and again with no AVD running, and paste both outputs into Evidence.

---

## Completion Checklist

- [x] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run (Stage 4 — Supervisor/reviewer step)
- [x] Lint passes (`npm run build` / `tsc` succeeds — no `src/` changes were made, no new lint surface)
- [x] Verification command run — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run (Stage 5 — Supervisor step; manual equivalent run above)
- [ ] `memory/MEMORY.md` updated (new infra pattern: ADB reachability via host networking) — Supervisor-only write, flagged for Stage 5
- [x] Supervisor notified: task ready for Stage 4 review
