import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 5902;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-token-123";
const home = mkdtempSync(join(tmpdir(), "ki-auth-"));
let proc;

before(async () => {
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(PORT), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: TOKEN },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + "/api/healthz")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("KI did not start");
});
after(() => { proc?.kill(); rmSync(home, { recursive: true, force: true }); });

test("healthz stays open", async () => {
  assert.equal((await fetch(BASE + "/api/healthz")).status, 200);
});

test("no token and wrong token are 401", async () => {
  assert.equal((await fetch(BASE + "/api/scans")).status, 401);
  assert.equal((await fetch(BASE + "/api/scans", { headers: { "x-ki-token": "wrong" } })).status, 401);
  assert.equal((await fetch(BASE + "/api/scans", { headers: { "x-ki-token": TOKEN + "x" } })).status, 401);
});

test("POST without token is 401 and stores nothing", async () => {
  const body = JSON.stringify({ id: "z", counts: {} });
  const r = await fetch(BASE + "/api/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(r.status, 401);
  const ok = await fetch(BASE + "/api/scans", { headers: { "x-ki-token": TOKEN } });
  assert.deepEqual((await ok.json()).scans, []);
});

test("correct token works; registry too", async () => {
  const h = { "x-ki-token": TOKEN };
  assert.equal((await fetch(BASE + "/api/scans", { headers: h })).status, 200);
  assert.equal((await fetch(BASE + "/api/registry", { headers: h })).status, 200);
});

test("CORS preflight is not blocked and allows the header", async () => {
  const r = await fetch(BASE + "/api/scans", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.match(r.headers.get("access-control-allow-headers"), /x-ki-token/);
});
