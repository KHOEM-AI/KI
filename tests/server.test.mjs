import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 5901;
const BASE = `http://127.0.0.1:${PORT}`;
const home = mkdtempSync(join(tmpdir(), "ki-test-"));
let proc;

const req = (method, path, body, raw) =>
  fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

before(async () => {
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(PORT), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + "/api/healthz")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("KI did not start");
});

after(() => { proc?.kill(); rmSync(home, { recursive: true, force: true }); });

test("healthz", async () => {
  const r = await req("GET", "/api/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, service: "ki" });
});

test("trailing slash and query string are ignored", async () => {
  assert.equal((await req("GET", "/api/healthz/?x=1")).status, 200);
});

test("unknown route is 404", async () => {
  assert.equal((await req("GET", "/api/nope")).status, 404);
});

test("OPTIONS preflight is 204 with CORS headers", async () => {
  const r = await req("OPTIONS", "/api/scans");
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("colors: save, upsert by id, list", async () => {
  assert.deepEqual((await (await req("GET", "/api/colors")).json()).palettes, []);
  let r = await req("POST", "/api/colors", { id: "a", cols: ["#fff"] });
  assert.equal((await r.json()).count, 1);
  r = await req("POST", "/api/colors", { id: "a", cols: ["#000"] });
  assert.equal((await r.json()).count, 1);
  const list = (await (await req("GET", "/api/colors")).json()).palettes;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].cols, ["#000"]);
});

test("colors: rejects bad input", async () => {
  assert.equal((await req("POST", "/api/colors", { cols: [] })).status, 400);
  assert.equal((await req("POST", "/api/colors", { id: 1, cols: [] })).status, 400);
  assert.equal((await req("POST", "/api/colors", { id: "x".repeat(65), cols: [] })).status, 400);
  assert.equal((await req("POST", "/api/colors", { id: "b", cols: new Array(65).fill("#fff") })).status, 400);
  assert.equal((await req("POST", "/api/colors", { id: "b", cols: "no" })).status, 400);
});

test("scans: save keeps only known fields", async () => {
  const r = await req("POST", "/api/scans", { id: "s1", counts: { car: 2 }, name: "n", evil: "x" });
  assert.equal(r.status, 200);
  const s = (await (await req("GET", "/api/scans")).json()).scans.find((x) => x.id === "s1");
  assert.deepEqual(s, { id: "s1", time: null, name: "n", gps: null, counts: { car: 2 } });
});

test("scans: rejects bad input", async () => {
  assert.equal((await req("POST", "/api/scans", { id: "s", counts: [] })).status, 400);
  assert.equal((await req("POST", "/api/scans", { id: "s", counts: null })).status, 400);
  assert.equal((await req("POST", "/api/scans", { id: "s" })).status, 400);
  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => ["k" + i, 1]));
  assert.equal((await req("POST", "/api/scans", { id: "s", counts: many })).status, 400);
});

test("bad JSON is 400", async () => {
  assert.equal((await req("POST", "/api/scans", undefined, "{oops")).status, 400);
});

test("body over 8 MB is rejected", async () => {
  let status = 0;
  try { status = (await req("POST", "/api/scans", undefined, "x".repeat(9 * 1024 * 1024))).status; }
  catch { status = 413; /* connection destroyed by server */ }
  assert.equal(status, 413);
});

test("POST /api/scan is 501", async () => {
  assert.equal((await req("POST", "/api/scan", {})).status, 501);
});

test("registry: index and every listed file are served", async () => {
  const idx = await (await req("GET", "/api/registry")).json();
  assert.ok(idx.files.length > 0);
  for (const f of idx.files.filter((x) => x !== "index.json")) {
    const r = await req("GET", "/api/registry/" + f.slice(0, -5));
    assert.equal(r.status, 200, f);
  }
});

test("registry: not-listed names, traversal and local/ are not served", async () => {
  for (const p of ["/api/registry/index", "/api/registry/local", "/api/registry/..%2Fpackage",
                   "/api/registry/../package", "/api/registry/block"]) {
    assert.equal((await req("GET", p)).status, 404, p);
  }
});

test("registry route set matches data/index.json", () => {
  const idx = JSON.parse(readFileSync("data/index.json", "utf8"));
  for (const f of idx.files) assert.match(f, /^[a-z0-9-]+\.json$/);
});
