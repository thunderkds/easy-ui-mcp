// T038: the stdio entry point (src/stdio.ts) that Glama's mcp-proxy runs.
// Spawns the real entry and speaks newline-delimited JSON-RPC on its stdin/stdout.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:net";
import { readFileSync } from "node:fs";

const HTTP_PORT = 8765;

/** Tool names registered in src/server.ts (same scan as test/docs-tools.test.ts): the HTTP server's tool list. */
function httpToolNames(): string[] {
  const src = readFileSync("src/server.ts", "utf8");
  const constants = new Map<string, string>();
  const block = src.match(/const TOOL = \{([\s\S]*?)\} as const;/);
  for (const [, key, name] of (block?.[1] ?? "").matchAll(/(\w+):\s*"([^"]+)"/g)) constants.set(key, name);
  const names: string[] = [];
  for (const [, literal, key] of src.matchAll(/register(?:Session)?Tool\(\s*(?:"([^"]+)"|TOOL\.(\w+))/g)) {
    const name = literal ?? constants.get(key);
    assert.ok(name, `cannot resolve a registerTool name (TOOL.${key})`);
    names.push(name);
  }
  return names.sort();
}

interface Stdio {
  proc: ChildProcessWithoutNullStreams;
  stdoutLines: string[];
  stderr: string;
  send(msg: object): void;
  reply(id: number, timeoutMs?: number): Promise<{ result?: any; error?: any }>;
  exited: Promise<number | null>;
}

function startStdio(): Stdio {
  const proc = spawn(process.execPath, ["--import", "tsx", "src/stdio.ts"], { stdio: "pipe", env: { ...process.env } });
  const stdoutLines: string[] = [];
  let buffered = "";
  let stderr = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    let nl: number;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, nl).replace(/\r$/, "");
      buffered = buffered.slice(nl + 1);
      if (line.length > 0) stdoutLines.push(line);
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  return {
    proc,
    stdoutLines,
    get stderr() {
      return stderr;
    },
    send: (msg) => void proc.stdin.write(JSON.stringify(msg) + "\n"),
    async reply(id, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        for (const line of stdoutLines) {
          try {
            const msg = JSON.parse(line);
            if (msg.id === id) return msg;
          } catch {
            // not JSON: the purity test reports it
          }
        }
        if (Date.now() > deadline) throw new Error(`no reply to id ${id}; stdout=${JSON.stringify(stdoutLines)} stderr=${stderr}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    exited,
  } as Stdio;
}

async function handshake(s: Stdio): Promise<string[]> {
  s.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "stdio-test", version: "0.0.0" } },
  });
  const init = await s.reply(1);
  assert.equal(init.result?.serverInfo?.name, "easy-ui-mcp");
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  s.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await s.reply(2);
  return (list.result.tools as { name: string }[]).map((t) => t.name).sort();
}

const running: Stdio[] = [];
const blockers: Server[] = [];

after(async () => {
  for (const s of running) if (s.proc.exitCode === null) s.proc.kill("SIGKILL");
  for (const b of blockers) await new Promise((r) => b.close(() => r(undefined)));
});

describe("stdio entry point (T038)", () => {
  test("initialize and tools/list succeed over stdio with the HTTP server's tool names", async () => {
    const s = startStdio();
    running.push(s);
    const names = await handshake(s);
    const expected = httpToolNames();
    assert.ok(expected.length > 10, "found the HTTP tool names in src/server.ts");
    assert.deepEqual(names, expected);
    s.proc.stdin.end();
    await s.exited;
  });

  test("stdout carries only JSON-RPC frames", async () => {
    const s = startStdio();
    running.push(s);
    await handshake(s);
    s.proc.stdin.end();
    await s.exited;
    assert.ok(s.stdoutLines.length >= 2);
    for (const line of s.stdoutLines) {
      const msg = JSON.parse(line); // throws on a banner or stray log line
      assert.equal(msg.jsonrpc, "2.0", line);
    }
  });

  test("works while another process holds port 8765 (stdio binds no port)", async () => {
    const blocker = createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(HTTP_PORT, resolve);
    }).catch((err) => {
      // Something else (e.g. the Docker container) already holds it: that serves the same purpose.
      assert.equal((err as NodeJS.ErrnoException).code, "EADDRINUSE");
    });
    const s = startStdio();
    running.push(s);
    const names = await handshake(s);
    assert.ok(names.includes("ui_start_session"));
    assert.doesNotMatch(s.stderr, /EADDRINUSE/);
    s.proc.stdin.end();
    assert.equal(await s.exited, 0);
  });

  test("exits 0 when stdin closes", async () => {
    const s = startStdio();
    running.push(s);
    await handshake(s);
    s.proc.stdin.end();
    const code = await Promise.race([
      s.exited,
      new Promise<string>((r) => setTimeout(() => r("still running after 10s"), 10_000).unref()),
    ]);
    assert.equal(code, 0);
  });

  test("SIGTERM exits 0", async () => {
    const s = startStdio();
    running.push(s);
    await handshake(s);
    s.proc.kill("SIGTERM");
    const code = await Promise.race([
      s.exited,
      new Promise<string>((r) => setTimeout(() => r("still running after 10s"), 10_000).unref()),
    ]);
    assert.equal(code, 0);
  });
});
