# HARNESS.md — REST API Reference

This document describes the REST API endpoints available in easy-ui-mcp for non-MCP callers (external CI/CD systems, scripts, manual testing).

**Note**: The primary interface is MCP (see `AGENTS.md`). This REST API is a **thin wrapper** for simple smoke tests and integration with systems that cannot speak MCP. For complex multi-step flows, drive the MCP tools directly from Claude Code.

---

## Endpoints

### `POST /api/run-test` — Run a Single-Navigate-and-Screenshot Test

Runs a minimal test: navigate to a URL, take a screenshot, generate a report.

**Request**

```http
POST /api/run-test HTTP/1.1
Host: localhost:8765
Content-Type: application/json

{
  "app_url_or_package": "https://example.com",
  "flow_description": "Check homepage loads",
  "platform": "web",
  "timeout": 30000
}
```

**Request Fields**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `app_url_or_package` | string | **Yes** | — | URL or app identifier to navigate to |
| `flow_description` | string | No | `<app_url_or_package>` | Human-readable label for the test run (used in reports) |
| `platform` | string | No | `"web"` | Target platform — only `"web"` is supported in v1 (mobile is deferred to v2) |
| `timeout` | number | No | `30000` | Test timeout in milliseconds |

**Validation**

- `app_url_or_package` must be a non-empty string. Returns `400` if missing or empty.
- `platform` must be `"web"` or omitted. Returns `400` if set to anything else (e.g., `"mobile"`, `"ios"`).
- `timeout` must be a positive number. Returns `400` if negative or zero.

**Response (Success)**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "passed",
  "report_url": "/app/reports/session-1b8a43f8-3e0d-4924-b108-e1342dbca060.html",
  "screenshots": [
    "/app/reports/screenshot-1782898618440.png"
  ],
  "logs": [
    {
      "timestamp": "2026-07-01T09:36:58.440Z",
      "action": "ui_navigate",
      "args": {
        "url": "https://example.com"
      },
      "ok": true,
      "detail": "https://example.com/"
    },
    {
      "timestamp": "2026-07-01T09:36:58.485Z",
      "action": "ui_take_screenshot",
      "args": {
        "path": "/app/reports/screenshot-1782898618440.png"
      },
      "ok": true
    }
  ]
}
```

**Response Fields**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Result: `"passed"`, `"failed"`, or `"timeout"` |
| `report_url` | string | Path to HTML report inside the container (readable via volume mount) |
| `screenshots` | string[] | Array of screenshot file paths (inside container) captured during the run |
| `logs` | object[] | Detailed action log (same format as MCP session reports) |

**Response (Error)**

When validation fails (missing field, invalid platform, etc.):

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Unsupported platform \"mobile\" — only \"web\" is supported in v1"
}
```

---

### `GET /health` — Liveness Check

Simple health-check endpoint for orchestrators and load balancers.

**Request**

```http
GET /health HTTP/1.1
Host: localhost:8765
```

**Response**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok"
}
```

Returns `200 OK` immediately if the server process is running, regardless of browser or report state.

---

## Working Example: curl

Run a test and check the response:

```bash
curl -s -X POST http://localhost:8765/api/run-test \
  -H "Content-Type: application/json" \
  -d '{
    "app_url_or_package": "https://example.com",
    "flow_description": "Homepage smoke test",
    "platform": "web",
    "timeout": 30000
  }' | jq .
```

**Expected output**:
```json
{
  "status": "passed",
  "report_url": "/app/reports/session-abc123.html",
  "screenshots": ["/app/reports/screenshot-xyz.png"],
  "logs": [...]
}
```

### Reading the Report

The `report_url` is a path **inside the container**. To read it from the host, use the volume mount:

```bash
# If running docker-compose, reports/ is volume-mounted to ./reports/ on the host
cat ./reports/session-abc123.html
```

Or, read the JSON report:
```bash
cat ./reports/session-abc123.json | jq .
```

---

## Status Field Values

| Status | Meaning | When |
|--------|---------|------|
| `"passed"` | All steps succeeded (navigate + screenshot) | No step failed |
| `"failed"` | At least one step failed | Navigation or screenshot failed; check logs and embedded screenshot in HTML report |
| `"timeout"` | Test exceeded timeout | Took longer than `timeout` param (default 30s) |

---

## Integration Tips

### Docker Compose Volume Mount

The `reports/` directory is volume-mounted:

```yaml
# docker-compose.yml
services:
  easy-ui-mcp:
    volumes:
      - ./reports:/app/reports
```

From the host, read reports via `./reports/`.

### Checking Report Status in a Script

```bash
#!/bin/bash

response=$(curl -s -X POST http://localhost:8765/api/run-test \
  -H "Content-Type: application/json" \
  -d '{
    "app_url_or_package": "https://example.com",
    "flow_description": "Smoke test",
    "platform": "web"
  }')

status=$(echo "$response" | jq -r '.status')

if [ "$status" == "passed" ]; then
  echo "Test passed!"
  report_url=$(echo "$response" | jq -r '.report_url')
  echo "Report: ./reports/$(basename $report_url)"
  exit 0
else
  echo "Test failed or timed out: $status"
  echo "$response" | jq '.'
  exit 1
fi
```

---

## v2 / Out of Scope

- **Multi-step flows**: This endpoint is designed for single-navigate-and-screenshot smoke tests. For multi-step flows, use the MCP interface and drive tool calls from Claude Code (see `AGENTS.md`).
- **Mobile platforms**: The `platform` field is reserved for future v2 expansion. Mobile via Appium or Maestro is deferred and will require additional container setup.
- **Custom step scripting**: No Selenium/Playwright step language support; the REST endpoint does not interpret step definitions. To add custom steps, write new MCP tools and call them from Claude Code.
- **CI/CD pipeline integration**: This is local-only for v1. Pipeline triggers (GitHub Actions, GitLab CI, etc.) are out of scope; set up your pipeline to call this endpoint via curl or an HTTP client library if needed (users are responsible for orchestration).

---

## Summary

- **Endpoint**: `POST /api/run-test` on `localhost:8765`
- **Simplest use case**: Navigate to a URL, take a screenshot, get a report
- **Complex flows**: Use MCP tools via Claude Code (see `AGENTS.md`)
- **Response**: JSON with `status`, `report_url`, `screenshots`, and action `logs`
- **Reports**: Accessible via `./reports/` volume mount on the host
- **v2 deferred**: Multi-step flows, mobile platforms, custom scripting, CI/CD triggers

For more context, see `PROJECT_SPEC.md` (architecture) and `PRD.md` (product intent).
