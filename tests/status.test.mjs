import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KI = 5961, UP = 5962, DEAD = 5969;
const TOKEN = "status-test-token";
const home = mkdtempSync(join(tmpdir(), "ki-st-"));
let up;
let proc;

const api = (id, base_url, extra = {}) => ({ id, name: id, base_url, health: "/health", enabled: true, ...extra });
const registry = { apis: [
  api("a-ok", `http://127.0.0.1:${UP}/ok`),
  api("b-auth", `http://127.0.0.1:${UP}/auth`),
  api("c-boom", `http://127.0.0.1:${UP}/boom`),
  api("d-dead", `http://127.0.0.1:${DEAD}`),
  api("e-off", `http://127.0.0.1:${UP}/ok`, { enabled: false }),
  api("f-ext", "http://example.com:80", { health: "/" }),
  api("g-mqtt", "mqtt://127.0.0.1:1883", { health: "" }),
  api("h-nohealth", `http://127.0.0.1:${UP}/ok`, { health: "" }),
] };

before(async () => {
  up = http.createServer((req, res) => {
    const code = { "/ok/health": 200, "/auth/health": 401, "/boom/health": 500 }[req.url] ?? 404;
    res.writeHead(code); res.end();
  }).listen(UP, "127.0.0.1");
  const file = join(home, "apis.json");
  writeFileSync(file, JSON.stringify(registry));
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(KI), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: TOKEN, KI_APIS_FILE: file },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${KI}/api/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("KI did not start");
});
after(() => { proc?.kill(); up?.close(); rmSync(home, { recursive: true, force: true }); });

test("status needs the KI token", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${KI}/api/status`)).status, 401);
});

test("status reports every state and never calls non-loopback hosts", async () => {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${KI}/api/status`, { headers: { "x-ki-token": TOKEN } });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 4000);
  const j = await r.json();
  const by = Object.fromEntries(j.services.map((s) => [s.id, s]));
  assert.equal(by["a-ok"].state, "ok");
  assert.equal(by["b-auth"].state, "up");
  assert.equal(by["b-auth"].http, 401);
  assert.equal(by["c-boom"].state, "error");
  assert.equal(by["d-dead"].state, "down");
  assert.equal(by["e-off"].state, "disabled");
  assert.equal(by["f-ext"].state, "skipped");
  assert.match(by["f-ext"].why, /loopback/);
  assert.equal(by["g-mqtt"].state, "skipped");
  assert.equal(by["h-nohealth"].state, "up"); // /ok answers 404
  assert.deepEqual(j.summary, { ok: 1, up: 2, error: 1, down: 1, disabled: 1, skipped: 2 });
});
