import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readStored } from "./stored.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const A = 5951, B = 5952;
const TOKEN = "notify-test-token";
const homeA = mkdtempSync(join(tmpdir(), "ki-nf-a-"));
const homeB = mkdtempSync(join(tmpdir(), "ki-nf-b-"));
const procs = [];

const start = async (port, home, env = {}) => {
  const p = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(port), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: TOKEN, ...env },
    stdio: "ignore",
  });
  procs.push(p);
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("KI did not start");
};
before(async () => { await start(A, homeA); await start(B, homeB, { KI_NOTIFY_LIMIT: "3" }); });
after(() => { for (const p of procs) p.kill(); rmSync(homeA, { recursive: true, force: true }); rmSync(homeB, { recursive: true, force: true }); });

const call = (port, method, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
  method,
  headers: { "x-ki-token": TOKEN, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});
const notify = (port, o) => call(port, "POST", "/api/notify", o).then((r) => r.json());
const list = (port, q = "") => call(port, "GET", "/api/notifications" + q).then((r) => r.json());

test("notifications need the KI token", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${A}/api/notifications`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${A}/api/notify`, { method: "POST", body: "{}" })).status, 401);
});

test("post, then list newest first with unread count", async () => {
  const a = await notify(A, { source: "ei-t", title: "ដំណើរការ", message: "សេវាចាប់ផ្តើម" });
  assert.equal(a.ok, true);
  await new Promise((r) => setTimeout(r, 5));
  await notify(A, { level: "warn", source: "ksv", title: "KSV API not ready" });
  const l = await list(A);
  assert.equal(l.total, 2);
  assert.equal(l.unread, 2);
  assert.equal(l.notifications[0].title, "KSV API not ready");
  assert.equal(l.notifications[1].level, "info");
  assert.equal(l.notifications[1].message, "សេវាចាប់ផ្តើម");
  assert.equal(l.notifications[1].read, false);
});

test("bad input is 400", async () => {
  const bad = [
    { source: "x", title: "t", level: "loud" },
    { source: "x" },
    { source: "../x", title: "t" },
    { source: "x", title: "   " },
    { source: "x", title: "y".repeat(121) },
    { source: "x", title: "t", message: 5 },
    { source: "x", title: "t", message: "m".repeat(1001) },
    [],
    null,
  ];
  for (const b of bad) assert.equal((await call(A, "POST", "/api/notify", b)).status, 400, JSON.stringify(b)?.slice(0, 40));
  assert.equal((await call(A, "POST", "/api/notify", "{oops")).status, 400);
});

test("body over 16 KB is 413", async () => {
  const r = await call(A, "POST", "/api/notify", JSON.stringify({ source: "x", title: "t", message: "z".repeat(20 * 1024) }));
  assert.equal(r.status, 413);
});

test("filters and limit", async () => {
  assert.equal((await list(A, "?level=warn")).notifications.length, 1);
  assert.equal((await list(A, "?source=ei-t")).notifications.length, 1);
  assert.equal((await list(A, "?limit=1")).notifications.length, 1);
  assert.equal((await list(A, "?unread=1")).notifications.length, 2);
});

test("mark read by ids and all", async () => {
  const first = (await list(A)).notifications[0];
  let r = await (await call(A, "POST", "/api/notifications/read", { ids: [first.id, "nope"] })).json();
  assert.equal(r.changed, 1);
  assert.equal((await list(A)).unread, 1);
  assert.equal((await list(A, "?unread=1")).notifications.length, 1);
  r = await (await call(A, "POST", "/api/notifications/read", { all: true })).json();
  assert.equal(r.changed, 1);
  assert.equal((await list(A)).unread, 0);
  assert.equal((await call(A, "POST", "/api/notifications/read", { ids: "x" })).status, 400);
  assert.equal((await call(A, "POST", "/api/notifications/read", {})).status, 400);
});

test("over the limit the oldest READ item goes first, unread alerts are kept", async () => {
  const ids = [];
  for (const t of ["A", "B", "C"]) ids.push((await notify(B, { source: "t", title: t })).id);
  await call(B, "POST", "/api/notifications/read", { ids: [ids[0]] }); // A is read
  await notify(B, { source: "t", title: "D" });
  let titles = (await list(B)).notifications.map((n) => n.title);
  assert.deepEqual(titles, ["D", "C", "B"]); // A (read) dropped, B kept
  await notify(B, { source: "t", title: "E" });
  titles = (await list(B)).notifications.map((n) => n.title);
  assert.deepEqual(titles, ["E", "D", "C"]); // everything unread: oldest dropped
});

test("stored on this device only, in the home folder", async () => {
  const stored = JSON.parse(await readStored(homeA, "notifications"));
  assert.ok(Array.isArray(stored) && stored.length >= 2);
});
