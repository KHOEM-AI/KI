import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UP = 5911, KI_A = 5912, KI_B = 5913, KI_C = 5914, DEAD = 5919;
const TOKEN = "ki-test-token";
const home = mkdtempSync(join(tmpdir(), "ki-gw-"));
const svc = (id, base_url, extra = {}) => ({ id, name: id, type: "x", base_url, enabled: true, auth: "none", ...extra });
const apisA = { apis: [
  svc("cidc-api", `http://127.0.0.1:${UP}`, { auth: "bearer", env_key: "CIDC_TOKEN" }),
  svc("ei-t", `http://127.0.0.1:${UP}`),
  svc("iqai-media", `http://127.0.0.1:${UP}/api/v1`, { auth: "bearer", env_key: "IQAI_TOKEN" }),
  svc("khoem-ai-api", `http://127.0.0.1:${UP}`, { auth: "header", auth_header: "x-api-key", env_key: "LANG_KEY" }),
] };
const apisB = { apis: [
  svc("cidc-api", "http://example.com:80", { auth: "bearer", env_key: "CIDC_TOKEN" }),
  svc("ei-t", `http://127.0.0.1:${DEAD}`),
  svc("iqai-media", `http://127.0.0.1:${UP}/api/v1`, { enabled: false }),
] };

const seen = [];
let upstream;
const procs = [];

const startKi = async (port, apis, env) => {
  const file = join(home, `apis-${port}.json`);
  writeFileSync(file, JSON.stringify(apis));
  const p = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(port), KI_ENV_FILE: "/nonexistent", KI_APIS_FILE: file, KI_API_TOKEN: TOKEN, ...env },
    stdio: "ignore",
  });
  procs.push(p);
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("KI did not start");
};

before(async () => {
  upstream = http.createServer((req, res) => {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ url: req.url, headers: req.headers }));
      }
      res.writeHead(200, { "Content-Type": req.headers["content-type"] ?? "application/octet-stream", "X-Applied": "ok", "X-Secret-Leak": "no" });
      res.end(body);
    });
  }).listen(UP, "127.0.0.1");
  await startKi(KI_A, apisA, { CIDC_TOKEN: "secret-cidc", IQAI_TOKEN: "secret-iqai", LANG_KEY: "" });
  await startKi(KI_B, apisB, { CIDC_TOKEN: "secret-cidc" });
  await startKi(KI_C, apisA, { KI_API_TOKEN: "" });
});
after(() => {
  for (const p of procs) p.kill();
  upstream?.close();
  rmSync(home, { recursive: true, force: true });
});

const gw = (port, path, init = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { "x-ki-token": TOKEN, ...(init.headers ?? {}) } });
// Sends the path exactly as written (fetch would normalise dot segments).
const rawGet = (port, path) => new Promise((ok, no) => {
  http.get({ host: "127.0.0.1", port, path, headers: { "x-ki-token": TOKEN } }, (r) => { r.resume(); ok(r.statusCode); }).on("error", no);
});

test("gateway needs the KI token", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${KI_A}/gw`)).status, 401);
});

test("gateway refuses to run when KI_API_TOKEN is not set", async () => {
  const r = await fetch(`http://127.0.0.1:${KI_C}/gw`);
  assert.equal(r.status, 503);
});

test("lists services and never shows secrets", async () => {
  const r = await gw(KI_A, "/gw");
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes("secret-"));
  const list = JSON.parse(text).services;
  assert.equal(list.length, 4);
  assert.equal(list.find((s) => s.service === "cidc").ready, true);
  assert.match(list.find((s) => s.service === "lang").problem, /LANG_KEY/);
});

test("unknown service is 404", async () => {
  assert.equal((await gw(KI_A, "/gw/nope/x")).status, 404);
  assert.equal((await gw(KI_A, "/gw/constructor/x")).status, 404);
});

test("routes and methods outside the allowlist are 403", async () => {
  assert.equal((await gw(KI_A, "/gw/cidc/modules", { method: "DELETE" })).status, 403);
  assert.equal((await gw(KI_A, "/gw/ei-t/admin")).status, 403);
  assert.equal((await gw(KI_A, "/gw/ei-t/v1/call")).status, 403);
});

test("bad paths are refused", async () => {
  assert.equal(await rawGet(KI_A, "/gw/cidc/%2e%2e/x"), 400);
  assert.equal(await rawGet(KI_A, "/gw/cidc/a%2fb"), 400);
  assert.equal(await rawGet(KI_A, "/gw/cidc/a//b"), 400);
  assert.equal(await rawGet(KI_A, "/gw/cidc/a%5cb"), 400);
});

test("GET is forwarded with the upstream credential; caller credentials are dropped", async () => {
  const r = await gw(KI_A, "/gw/cidc/modules?x=1", { headers: { authorization: "Bearer evil", cookie: "a=b" } });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.url, "/api/cidc/modules?x=1");
  assert.equal(b.headers.authorization, "Bearer secret-cidc");
  assert.equal(b.headers["x-ki-token"], undefined);
  assert.equal(b.headers.cookie, undefined);
});

test("POST JSON round trip", async () => {
  const body = JSON.stringify({ fn: "add", args: [1, 2] });
  const r = await gw(KI_A, "/gw/ei-t/v1/call", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), body);
});

test("binary body streams through iqai with path mapping and X-Applied", async () => {
  const buf = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31) & 255;
  const r = await gw(KI_A, "/gw/iqai/videos/edit?trimStart=1", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: buf });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-applied"), "ok");
  assert.equal(r.headers.get("x-secret-leak"), null);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(buf));
  const last = seen.at(-1);
  assert.equal(last.url, "/api/v1/videos/edit?trimStart=1");
  assert.equal(last.headers.authorization, "Bearer secret-iqai");
});

test("body over the service limit is 413", async () => {
  const r = await gw(KI_A, "/gw/ei-t/v1/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(100 * 1024) });
  assert.equal(r.status, 413);
});

test("missing upstream credential is 503", async () => {
  const r = await gw(KI_A, "/gw/lang/health");
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /LANG_KEY/);
});

test("non-loopback, disabled and unreachable upstreams are refused", async () => {
  let r = await gw(KI_B, "/gw/cidc/health");
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /loopback/);
  r = await gw(KI_B, "/gw/iqai/health");
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /disabled/);
  assert.equal((await gw(KI_B, "/gw/ei-t/health")).status, 502);
});
