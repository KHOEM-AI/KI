import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const sqlite = hasSqlite && process.env.KI_STORAGE !== "json";
const homes = [];
const newHome = () => { const h = mkdtempSync(join(tmpdir(), "ki-dbapi-")); homes.push(h); return h; };
test.after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

// A fresh process is a fresh start of KI. The script prints one JSON value.
const run = (home, code) => {
  const r = spawnSync("node", ["--input-type=module", "-e", 'import * as D from "./src/database.mjs";\n' + code], { env: { ...process.env, HOME: home }, encoding: "utf8", cwd: process.cwd() });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
};
const fails = `const code = async (f) => { try { await f(); return "no error"; } catch (e) { return e.message; } };`;

test("insert, get, update, delete keep working", () => {
  const h = newHome();
  const out = run(h, `
    const a = await D.databaseInsert("users", { name: "Dara" });
    const got = await D.databaseGet("users", a.id);
    const up = await D.databaseUpdate("users", a.id, { name: "Dara K" });
    const list = await D.databaseFind("users");
    const del = await D.databaseDelete("users", a.id);
    const again = await D.databaseDelete("users", a.id);
    console.log(JSON.stringify({ id: a.id, created: a.createdAt, got: got.name, up: up.name, same: up.createdAt === a.createdAt, n: list.length, del, again, after: (await D.databaseFind("users")).length }));`);
  assert.match(out.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual([out.got, out.up, out.same, out.n, out.del, out.again, out.after], ["Dara", "Dara K", true, 1, true, false, 0]);
});

test("bad collections, ids and documents are refused with the same error codes", () => {
  const h = newHome();
  const out = run(h, fails + `
    const id = "11111111-1111-1111-1111-111111111111";
    console.log(JSON.stringify([
      await code(() => D.databaseFind("../../etc")), await code(() => D.databaseInsert("nope", {})),
      await code(() => D.databaseGet("users", "x")), await code(() => D.databaseInsert("users", [1])),
      await code(() => D.databaseInsert("users", { big: "x".repeat(70 * 1024) })),
      await code(() => D.databaseUpdate("users", id, { id: "z" })), await code(() => D.databaseUpdate("users", id, { createdAt: "z" })),
      await D.databaseUpdate("users", id, { a: 1 }),
    ]));`);
  assert.deepEqual(out, ["INVALID_COLLECTION", "INVALID_COLLECTION", "INVALID_ID", "INVALID_DOCUMENT", "DOCUMENT_TOO_LARGE", "PROTECTED_FIELD", "PROTECTED_FIELD", null]);
});

test("a collection holds at most 1000 documents", () => {
  const h = newHome();
  const out = run(h, fails + `
    for (let i = 0; i < 1000; i++) await D.databaseInsert("api_usage", { i });
    console.log(JSON.stringify([(await D.databaseFind("api_usage")).length, await code(() => D.databaseInsert("api_usage", { i: 1000 }))]));`);
  assert.deepEqual(out, [1000, "COLLECTION_LIMIT"]);
});

test("documents are saved for the next start, in the KI database (not in ~/.ki-database)", () => {
  const h = newHome();
  const id = run(h, `console.log(JSON.stringify((await D.databaseInsert("projects", { title: "p1" })).id))`);
  assert.equal(run(h, `console.log(JSON.stringify((await D.databaseFind("projects")).map((d) => d.title)))`)[0], "p1");
  assert.equal(run(h, `console.log(JSON.stringify((await D.databaseGet("projects", ${JSON.stringify(id)})).title))`), "p1");
  assert.equal(existsSync(join(h, ".ki-database")), false, "no separate database folder any more");
  if (sqlite) assert.ok(existsSync(join(h, ".ki", "ki.db")));
});

test("the older ~/.ki-database/<collection>.json is copied in once and never changed", () => {
  const h = newHome();
  mkdirSync(join(h, ".ki-database"));
  const oldText = JSON.stringify([{ id: "22222222-2222-2222-2222-222222222222", name: "old", createdAt: "x", updatedAt: "x" }]);
  writeFileSync(join(h, ".ki-database", "users.json"), oldText);
  writeFileSync(join(h, ".ki-database", "plugins.json"), "{broken");
  assert.equal(run(h, `console.log(JSON.stringify((await D.databaseFind("users")).map((d) => d.name)))`)[0], "old");
  assert.deepEqual(run(h, `console.log(JSON.stringify(await D.databaseFind("plugins")))`), []); // broken: ignored
  run(h, `await D.databaseInsert("users", { name: "new" }); console.log("1")`);
  // the old file now looks different from the database; the database must win and keep its newer data
  writeFileSync(join(h, ".ki-database", "users.json"), "[]");
  assert.deepEqual(run(h, `console.log(JSON.stringify((await D.databaseFind("users")).map((d) => d.name).sort()))`), ["new", "old"]);
  assert.equal(readFileSync(join(h, ".ki-database", "plugins.json"), "utf8"), "{broken");
});

test("database collections do not show up in /v1/data", () => {
  const h = newHome();
  const r = spawnSync("node", ["--input-type=module", "-e", `
    import * as D from "./src/database.mjs"; import { makeStore, listNames } from "./src/db.mjs";
    await D.databaseInsert("users", { a: 1 }); makeStore("data-notes").save({});
    console.log(JSON.stringify(listNames("data-")));`], { env: { ...process.env, HOME: h }, encoding: "utf8", cwd: process.cwd() });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), ["data-notes"]);
});

test("health says which storage engine runs", () => {
  const h = newHome();
  const out = run(h, `console.log(JSON.stringify(await D.databaseHealth()))`);
  assert.equal(out.ok, true);
  assert.equal(out.engine, sqlite ? "sqlite" : "json");
});
