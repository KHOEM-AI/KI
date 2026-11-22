import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UP = 5991, KI = 5992;
const TOKEN = "ki-keys-master";
const home = mkdtempSync(join(tmpdir(), "ki-keys-"));
const svc = (id, extra = {}) => ({ id, name: id, type: "x", base_url: `http://127.0.0.1:${UP}`, health: "/health", enabled: true, auth: "none", ...extra });
const apis = { apis: [svc("ai-backend", { auth: "header", auth_header: "x-api-key", env_key: "KHOEM_API_KEY" }), svc("ei-t")] };
const seen = [];
let upstream, proc;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => { seen.push({ url: req.url, headers: req.headers }); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  }).listen(UP, "127.0.0.1");
  const file = join(home, "apis.json");
  writeFileSync(file, JSON.stringify(apis));
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(KI), KI_ENV_FILE: "/nonexistent", KI_APIS_FILE: file, KI_API_TOKEN: TOKEN, KHOEM_API_KEY: "secret-ai", KI_KEY_RATE_PER_MIN: "5" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${KI}/api/healthz`)).ok) return; } catch {}
    await wait(100);
  }
  throw new Error("KI did not start");
});
after(() => { proc?.kill(); upstream?.close(); rmSync(home, { recursive: true, force: true }); });

const call = (headers, method, path, body) => fetch(`http://127.0.0.1:${KI}${path}`, {
  method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const master = (m, p, b) => call({ "x-ki-token": TOKEN }, m, p, b);
const asKey = (key) => (m, p, b) => call({ "x-ki-key": key }, m, p, b);
const make = async (name, scopes) => { const r = await master("POST", "/v1/keys", { name, scopes }); assert.equal(r.status, 200); return r.json(); };

let dev; // { key, record }

test("master creates a key; the key is shown once and only its hash is stored", async () => {
  dev = await make("app1", ["data", "chat"]);
  assert.match(dev.key, /^kik_[\w-]{40,}$/);
  assert.deepEqual(dev.record.scopes, ["data", "chat"]);
  assert.equal(dev.record.hash, undefined);
  const list = await (await master("GET", "/v1/keys")).json();
  assert.ok(!JSON.stringify(list).includes(dev.key));
  assert.ok(list.scopes.includes("files"));
  const disk = readFileSync(join(home, ".ki-keys.json"), "utf8");
  assert.ok(!disk.includes(dev.key));
  assert.match(disk, /"hash":"[a-f0-9]{64}"/);
  assert.equal(statSync(join(home, ".ki-keys.json")).mode & 0o777, 0o600);
});

test("bad key requests are 400", async () => {
  for (const b of [{}, { name: "", scopes: ["data"] }, { name: "x", scopes: [] }, { name: "x", scopes: ["admin"] }, { name: "x", scopes: "data" }, { name: "y".repeat(61), scopes: ["data"] }])
    assert.equal((await master("POST", "/v1/keys", b)).status, 400, JSON.stringify(b));
  assert.equal((await master("DELETE", "/v1/keys/zz")).status, 400);
  assert.equal((await master("DELETE", "/v1/keys/00000000")).status, 404);
});

test("a key works on its scopes and the module credential is never the key", async () => {
  const k = asKey(dev.key);
  assert.equal((await k("PUT", "/v1/data/notes/a", { x: 1 })).status, 200);
  assert.equal((await (await k("GET", "/v1/data/notes/a")).json()).doc.x, 1);
  assert.equal((await k("POST", "/v1/chat", { message: "hi" })).status, 200);
  assert.equal(seen.at(-1).url, "/api/chat");
  assert.equal(seen.at(-1).headers["x-api-key"], "secret-ai");
  assert.equal(seen.at(-1).headers["x-ki-key"], undefined);
  assert.equal((await k("GET", "/v1")).status, 200);
});

test("a key is refused outside its scopes and on every non-/v1 or admin route", async () => {
  const k = asKey(dev.key);
  for (const [m, p] of [["GET", "/v1/files"], ["POST", "/v1/translate"], ["GET", "/v1/keys"], ["POST", "/v1/keys"], ["GET", "/v1/usage"], ["GET", "/v1/system"],
    ["GET", "/api/scans"], ["GET", "/api/registry"], ["GET", "/gw"], ["GET", "/gw/ai/api/health"], ["GET", "/v1/chat/x"], ["GET", "/v1/data/../../api/scans"]])
    assert.equal((await k(m, p, m === "POST" ? {} : undefined)).status, 403, m + " " + p);
});

test("missing, wrong and revoked keys are 401", async () => {
  assert.equal((await call({}, "GET", "/v1/data")).status, 401);
  assert.equal((await asKey("kik_wrong")("GET", "/v1/data")).status, 401);
  assert.equal((await asKey(dev.key + "x")("GET", "/v1/data")).status, 401);
  const tmp = await make("temp", ["data"]);
  assert.equal((await asKey(tmp.key)("GET", "/v1/data")).status, 200);
  assert.equal((await master("DELETE", "/v1/keys/" + tmp.record.id)).status, 200);
  assert.equal((await asKey(tmp.key)("GET", "/v1/data")).status, 401);
});

test("the master token still works everywhere", async () => {
  assert.equal((await master("GET", "/api/registry")).status, 200);
  assert.equal((await master("GET", "/v1/files")).status, 200);
});

test("per-key rate limit answers 429", async () => {
  const r = await make("rate", ["data"]);
  const k = asKey(r.key);
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await k("GET", "/v1/data")).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
});

test("usage statistics group routes and count per key; no secrets", async () => {
  await wait(400);
  const r = await master("GET", "/v1/usage?days=1");
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes(dev.key) && !text.includes(TOKEN));
  const u = JSON.parse(text);
  assert.ok(u.total > 5);
  assert.ok(u.status["2xx"] > 0 && u.status["4xx"] > 0);
  assert.ok(u.routes.some((x) => x.route === "PUT /v1/data/:collection/:id"));
  const mine = u.keys.find((x) => x.id === dev.record.id);
  assert.equal(mine.name, "app1");
  assert.ok(mine.count >= 3);
  assert.equal((await master("POST", "/v1/usage", {})).status, 405);
});

test("system status: version, storage, keys; services only on request", async () => {
  let s = await (await master("GET", "/v1/system")).json();
  assert.equal(s.service, "ki");
  assert.match(s.version, /^\d+\.\d+\.\d+$/);
  assert.ok(s.keys.active >= 2 && s.keys.revoked >= 1);
  assert.ok(s.storage.collections >= 1);
  assert.equal(s.services, undefined);
  s = await (await master("GET", "/v1/system?services=1")).json();
  assert.equal(s.services.list.length, 2);
});

test("CORS allows the x-ki-key header", async () => {
  const r = await fetch(`http://127.0.0.1:${KI}/v1/chat`, { method: "OPTIONS" });
  assert.match(r.headers.get("access-control-allow-headers"), /x-ki-key/);
});
