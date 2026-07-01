Refined Goal
Create a unified UI Testing MCP Server that:

Runs easily via Docker locally
Supports Web (Playwright) + Mobile/Native (Appium + Maestro)
Is easy for Harness agents/pipelines to call
Returns clear reports back to the Harness repository


Optimized Implementation Plan (Agent-Friendly)
Phase 0: Preparation (Agent does this first)

Create new repository: harness-ui-testing-mcp
Use TypeScript + Node.js
Add clear AGENTS.md and HARNESS.md files with instructions for future agents

Phase 1: Core MCP Server (High Priority – 1-2 days)
Agent Instructions:

Initialize project with playwright-mcp as base
Create unified tool interface:
ui_run_flow(description, platform, target)
ui_take_screenshot
ui_get_page_state

Implement basic reporting (JSON + HTML with screenshots)

Success Criteria:

MCP server runs on http://localhost:8765
AI agent can connect and run simple web test

Phase 2: Docker & Local Execution (Must be rock-solid)
Agent Task:

Create production-ready Dockerfile + docker-compose.yml
Include Playwright browsers + basic Android emulator support
Add health check endpoint /health
Add volume for reports output

Key: Make it one-command start: docker-compose up -d
Phase 3: Harness Integration Layer
Agent Task:

Create a simple REST API wrapper (/api/run-test) so Harness pipelines or agents can easily call it without full MCP client
Input: { platform, flow_description, app_url_or_package, timeout }
Output: { status, report_url, screenshots, logs }
Add GitHub Actions / Harness pipeline step example that calls this MCP and uploads report back to the repo as artifact.

Phase 4: Mobile Support
Agent Task (after web works):

Integrate Appium + Maestro
Support switching context: web ↔ android ↔ ios
Add device management tools

Phase 5: Polish & Self-Improvement

Add error recovery and self-healing hints
Generate nice HTML report with video/screenshots if possible
Add logging and observability


Folder Structure (Agent should create this)
text/harness-ui-testing-mcp
├── docker-compose.yml
├── Dockerfile
├── package.json
├── AGENTS.md          # Critical for future agents
├── HARNESS.md         # How to integrate with Harness
├── src/
│   ├── server.ts      # Main MCP server
│   ├── tools/
│   │   ├── web.ts
│   │   ├── mobile.ts
│   │   └── unified.ts
│   ├── reports/       # Report generator
│   └── api/           # REST wrapper for Harness
├── reports/           # Output folder (volume mounted)
└── examples/          # Test flow examples

Success Metrics for the Agent

Can run locally with docker compose up
Harness pipeline can call it and get report
One AI agent can fully implement web testing first, then expand to mobile
Clear documentation so next agent can extend it easily