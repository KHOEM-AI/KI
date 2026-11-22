import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";

let PORT = 0;
let BASE = "";
const TOKEN = "access-log-token-xyz";
const home = mkdtempSync(join(tmpdir(), "ki-log-"));
const LOG = join(home, ".ki-access.jsonl");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc;

before(async () => {
  writeFileSync(LOG, "x".repeat(2 * 1024 * 1024 + 10));
  PORT = await new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const n = s.address().port; s.close(() => res(n)); });
  });
  BASE = `http://127.0.0.1:${PORT}`;
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(PORT), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: TOKEN },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error("KI exited early (port in use?)");
    try { if ((await fetch(BASE + "/api/healthz")).ok) return; } catch {}
    await wait(100);
  }
  throw new Error("KI did not start");
});

after(() => { proc?.kill(); rmSync(home, { recursive: true, force: true }); });

test("an oversized log is rotated to .1 and a new small log starts", async () => {
  await wait(300);
  assert.ok(existsSync(LOG + ".1"));
  assert.ok(statSync(LOG).size < 1024);
});

test("rows hold method, path, status, ms; 401 is recorded; query, token and body are not", async () => {
  await fetch(BASE + "/api/scans");
  await fetch(BASE + "/api/scans?secret=abc123", { headers: { "x-ki-token": TOKEN } });
  await fetch(BASE + "/api/nope", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"leak":"bodyvalue"}' });
  await wait(300);
  const raw = readFileSync(LOG, "utf8");
  const rows = raw.trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.m === "GET" && r.p === "/api/scans" && r.s === 401));
  assert.ok(rows.some((r) => r.m === "GET" && r.p === "/api/scans" && r.s === 200));
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ["m", "ms", "p", "s", "t"]);
  for (const bad of [TOKEN, "abc123", "secret", "bodyvalue"]) assert.ok(!raw.includes(bad), bad);
});
