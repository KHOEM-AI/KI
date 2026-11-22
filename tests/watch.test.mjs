import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// notify.mjs reads HOME when it is loaded, so point it at a temp folder first.
const home = mkdtempSync(join(tmpdir(), "ki-watch-"));
process.env.HOME = home;
const { addNotification } = await import("../src/notify.mjs");
const { pollOnce, startWatcher } = await import("../src/watch.mjs");

const KI = 5971, UP = 5972, DEAD = 5979;
const TOKEN = "watch-test-token";
let up;
let proc;
after(() => { proc?.kill(); up?.close(); rmSync(home, { recursive: true, force: true }); });

const feed = (...rounds) => { let i = 0; return async () => rounds[Math.min(i++, rounds.length - 1)]; };
const svc = (state, extra = {}) => ({ id: "x", name: "X svc", state, ...extra });

test("an alert needs two bad polls in a row, and is sent once", async () => {
  const sent = [];
  const mem = new Map();
  const opts = { check: feed([svc("down", { why: "unreachable" })]), notify: (n, o) => sent.push([n, o]) };
  await pollOnce(mem, opts);
  assert.equal(sent.length, 0);
  await pollOnce(mem, opts);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].level, "error");
  assert.equal(sent[0][0].title, "X svc is down");
  assert.equal(sent[0][0].message, "unreachable");
  assert.deepEqual(sent[0][1], { dedupe: true });
  await pollOnce(mem, opts);
  assert.equal(sent.length, 1);
});

test("one bad poll between good ones raises nothing", async () => {
  const sent = [];
  const mem = new Map();
  const check = feed([svc("ok")], [svc("down")], [svc("ok")], [svc("down")], [svc("ok")]);
  for (let i = 0; i < 5; i++) await pollOnce(mem, { check, notify: (n) => sent.push(n) });
  assert.equal(sent.length, 0);
});

test("a recovery after an alert says the service is back, once", async () => {
  const sent = [];
  const mem = new Map();
  const check = feed([svc("error", { http: 500 })], [svc("error", { http: 500 })], [svc("ok")], [svc("ok")]);
  for (let i = 0; i < 4; i++) await pollOnce(mem, { check, notify: (n) => sent.push(n) });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].level, "warn");
  assert.equal(sent[0].message, "HTTP 500");
  assert.equal(sent[1].level, "info");
  assert.equal(sent[1].title, "X svc is back");
});

test("disabled and skipped services are ignored; a failing check changes nothing", async () => {
  const sent = [];
  const mem = new Map();
  const notify = (n) => sent.push(n);
  for (let i = 0; i < 3; i++) await pollOnce(mem, { check: feed([svc("disabled"), svc("skipped", { id: "y" })]), notify });
  await pollOnce(mem, { check: async () => { throw new Error("registry unreadable"); }, notify });
  assert.equal(sent.length, 0);
});

test("addNotification: validates, and dedupe skips an unread twin", () => {
  assert.equal(addNotification({ source: "../x", title: "t" }), null);
  assert.equal(addNotification(null), null);
  const a = addNotification({ source: "status", title: "S is down", level: "error" }, { dedupe: true });
  assert.ok(a && a.id);
  assert.equal(addNotification({ source: "status", title: "S is down", level: "error" }, { dedupe: true }), null);
  assert.ok(addNotification({ source: "status", title: "S is down", level: "error" })); // without dedupe it is stored
});

test("the watcher is off unless KI_WATCH_SECONDS is set", () => {
  delete process.env.KI_WATCH_SECONDS;
  assert.equal(startWatcher(), null);
  process.env.KI_WATCH_SECONDS = "0";
  assert.equal(startWatcher(), null);
  process.env.KI_WATCH_SECONDS = "30";
  const t = startWatcher();
  assert.ok(t);
  clearInterval(t);
  delete process.env.KI_WATCH_SECONDS;
});

test("running KI with KI_WATCH_SECONDS=1 raises one alert for a dead service and none for a live one", async () => {
  up = http.createServer((_req, res) => { res.writeHead(200); res.end(); }).listen(UP, "127.0.0.1");
  const file = join(home, "apis.json");
  writeFileSync(file, JSON.stringify({ apis: [
    { id: "live", name: "Live svc", base_url: `http://127.0.0.1:${UP}`, health: "/health", enabled: true },
    { id: "dead", name: "Dead svc", base_url: `http://127.0.0.1:${DEAD}`, health: "/health", enabled: true },
  ] }));
  const kiHome = mkdtempSync(join(tmpdir(), "ki-watch-run-"));
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: kiHome, PORT: String(KI), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: TOKEN, KI_APIS_FILE: file, KI_WATCH_SECONDS: "1" },
    stdio: "ignore",
  });
  const get = () => fetch(`http://127.0.0.1:${KI}/api/notifications`, { headers: { "x-ki-token": TOKEN } }).then((r) => r.json());
  let list = [];
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { list = (await get()).notifications; } catch { continue; }
    if (list.some((n) => n.title === "Dead svc is down")) break;
  }
  const alerts = list.filter((n) => n.source === "status");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, "Dead svc is down");
  assert.equal(alerts[0].level, "error");
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal((await get()).notifications.filter((n) => n.source === "status").length, 1); // still one, no repeats
  rmSync(kiHome, { recursive: true, force: true });
});
