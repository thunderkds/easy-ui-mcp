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

- [ ] Restated intent confirmed to match the user's request
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary
- [ ] Every Acceptance Criterion below traces to FR-012/FR-013
- [ ] FR-012, FR-013 exist in `PRD.md` and are covered by the Acceptance Criteria below

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
| **New test(s) cover Acceptance Criteria (file paths pasted)** | ☐ pass / ☐ fail | |
| Verification command run | ☐ pass / ☐ fail | |
| Negative cases hold | ☐ pass / ☐ fail | |
| verify | ☐ pass / ☐ fail | |
| Review scope bounded to the change's blast radius | ☐ pass / ☐ fail | |
| Full smoke suite still green (no regression) | ☐ pass / ☐ fail | |
| UI: Visual regression | ☐ N/A | Pure-backend infra task |
| UI: Design-system compliance | ☐ N/A | Pure-backend infra task |
| UI: Responsiveness | ☐ N/A | Pure-backend infra task |

---

## UI / Design Acceptance Criteria

Deleted — pure-backend/infra task, no UI component. All three UI Evidence rows above marked N/A.

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

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Lint passes
- [ ] Verification command run — output pasted into Evidence table
- [ ] `Skill({ skill: "verify" })` run
- [ ] `memory/MEMORY.md` updated (new infra pattern: ADB reachability via host networking)
- [ ] Supervisor notified: task ready for Stage 4 review
