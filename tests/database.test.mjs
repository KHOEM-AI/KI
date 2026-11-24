import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// database.mjs resolves ~/.ki-database when it is loaded, so point HOME at a temp folder first.
const home = mkdtempSync(join(tmpdir(), "ki-db-"));
process.env.HOME = home;
const db = await import("../src/database.mjs");

const KI = 5981, TOKEN = "database-test-token";
const kiHome = mkdtempSync(join(tmpdir(), "ki-db-http-"));
let proc;
after(() => { proc?.kill(); rmSync(home, { recursive: true, force: true }); rmSync(kiHome, { recursive: true, force: true }); });

const fails = (p, code) => assert.rejects(p, (e) => e.message === code);

test("only the six known collections exist", async () => {
  assert.deepEqual((await db.databaseList()).sort(), ["api_usage", "developer_accounts", "integrations", "plugins", "projects", "users"]);
  await fails(db.databaseFind("../etc/passwd"), "INVALID_COLLECTION");
  await fails(db.databaseInsert("nope", {}), "INVALID_COLLECTION");
});

test("insert, get, update, delete", async () => {
  const a = await db.databaseInsert("projects", { name: "KI" });
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.ok(a.createdAt && a.updatedAt);
  assert.equal((await db.databaseGet("projects", a.id)).name, "KI");
  const b = await db.databaseUpdate("projects", a.id, { name: "KI v2", extra: 1 });
  assert.equal(b.name, "KI v2");
  assert.equal(b.id, a.id);
  assert.equal(b.createdAt, a.createdAt);
  assert.equal(await db.databaseUpdate("projects", "00000000-0000-0000-0000-000000000000", { x: 1 }), null);
  assert.equal(await db.databaseDelete("projects", a.id), true);
  assert.equal(await db.databaseDelete("projects", a.id), false);
  assert.equal(await db.databaseGet("projects", a.id), null);
});

test("bad input: ids, documents, protected fields", async () => {
  await fails(db.databaseGet("projects", "not-an-id"), "INVALID_ID");
  await fails(db.databaseInsert("projects", [1]), "INVALID_DOCUMENT");
  await fails(db.databaseInsert("projects", null), "INVALID_DOCUMENT");
  const a = await db.databaseInsert("projects", { n: 1 });
  await fails(db.databaseUpdate("projects", a.id, { id: "x" }), "PROTECTED_FIELD");
  await fails(db.databaseUpdate("projects", a.id, { createdAt: "x" }), "PROTECTED_FIELD");
});

test("a document cannot grow past 64 KB through repeated updates", async () => {
  const a = await db.databaseInsert("plugins", { a: "x".repeat(40_000) });
  await fails(db.databaseUpdate("plugins", a.id, { b: "y".repeat(40_000) }), "DOCUMENT_TOO_LARGE");
  const kept = await db.databaseGet("plugins", a.id);
  assert.equal(kept.b, undefined); // the refused update changed nothing
  await fails(db.databaseInsert("plugins", { big: "z".repeat(70_000) }), "DOCUMENT_TOO_LARGE");
});

test("parallel inserts are all kept", async () => {
  const before = (await db.databaseFind("integrations")).length;
  await Promise.all(Array.from({ length: 25 }, (_, i) => db.databaseInsert("integrations", { i })));
  assert.equal((await db.databaseFind("integrations")).length, before + 25);
});

test("a collection holds at most 1000 documents", async () => {
  await Promise.all(Array.from({ length: 1000 }, (_, i) => db.databaseInsert("api_usage", { i })));
  await fails(db.databaseInsert("api_usage", { i: 1000 }), "COLLECTION_LIMIT");
  assert.equal((await db.databaseFind("api_usage")).length, 1000);
});

test("data is private: the KI database file is mode 600 (or the JSON file, when sqlite is missing)", async () => {
  await db.databaseInsert("users", { name: "u" });
  const { engine } = await import("../src/db.mjs");
  if (engine() === "sqlite") {
    assert.equal(statSync(join(home, ".ki")).mode & 0o777, 0o700);
    assert.equal(statSync(join(home, ".ki", "ki.db")).mode & 0o777, 0o600);
  } else {
    assert.equal(statSync(join(home, ".ki-database-users.json")).mode & 0o777, 0o600);
  }
});

test("an older ~/.ki-database file is copied in once and never changed", async () => {
  const dir = join(home, ".ki-database");
  mkdirSync(dir, { recursive: true });
  const old = JSON.stringify([
    { id: "11111111-1111-4111-8111-111111111111", name: "old-a" },
    { id: "22222222-2222-4222-8222-222222222222", name: "old-b" },
  ]);
  const file = join(dir, "developer_accounts.json");
  writeFileSync(file, old);
  const found = await db.databaseFind("developer_accounts"); // first read of this collection: the old file is copied in
  assert.deepEqual(found.map((d) => d.name), ["old-a", "old-b"]);
  const added = await db.databaseInsert("developer_accounts", { name: "new" });
  assert.equal((await db.databaseFind("developer_accounts")).length, 3);
  assert.equal((await db.databaseGet("developer_accounts", added.id)).name, "new");
  assert.equal(readFileSync(file, "utf8"), old); // the old file stays exactly as it was
});

// ---------- over HTTP (/v1/database) ----------
const call = (path, { method = "GET", body, headers = {} } = {}) =>
  fetch(`http://127.0.0.1:${KI}${path}`, {
    method, headers: { "x-ki-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

test("start KI for the HTTP checks", async () => {
  proc = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: kiHome, PORT: String(KI), KI_ENV_FILE: "/nonexistent", KI_API_TOKEN: TOKEN },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${KI}/api/healthz`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail("KI did not start");
});

test("HTTP: needs the master token; a developer key is refused", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${KI}/v1/database`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${KI}/v1/database`, { headers: { "x-ki-token": "wrong" } })).status, 401);
  const made = await (await call("/v1/keys", { method: "POST", body: { name: "t", scopes: ["data", "files"] } })).json();
  assert.ok(made.key);
  const r = await fetch(`http://127.0.0.1:${KI}/v1/database/users`, { headers: { "x-ki-key": made.key } });
  assert.ok([401, 403].includes(r.status), `a developer key must not read users, got ${r.status}`);
});

test("HTTP: create, read, update, delete", async () => {
  const c = await call("/v1/database/projects", { method: "POST", body: { name: "demo" } });
  assert.equal(c.status, 201);
  const { document } = await c.json();
  assert.equal((await (await call(`/v1/database/projects/${document.id}`)).json()).name, "demo");
  const u = await call(`/v1/database/projects/${document.id}`, { method: "PUT", body: { name: "demo2" } });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).document.name, "demo2");
  const list = await (await call("/v1/database/projects")).json();
  assert.equal(list.count, 1);
  assert.equal((await call(`/v1/database/projects/${document.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await call(`/v1/database/projects/${document.id}`)).status, 404);
});

test("HTTP: bad collection, bad id, bad body, too large", async () => {
  assert.equal((await call("/v1/database/nope")).status, 400);
  assert.equal((await call("/v1/database/projects/not-an-id")).status, 400);
  assert.equal((await call("/v1/database/projects", { method: "POST", body: "[1]" })).status, 400);
  assert.equal((await call("/v1/database/projects", { method: "POST", body: "{broken" })).status, 400);
  const big = await call("/v1/database/projects", { method: "POST", body: { x: "a".repeat(70_000) } });
  assert.equal(big.status, 413);
  assert.equal((await call("/v1/database/projects", { method: "DELETE" })).status, 405);
});
