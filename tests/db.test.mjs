import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStored, dbPath } from "./stored.mjs";

const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const forceJson = process.env.KI_STORAGE === "json";
const expected = hasSqlite && !forceJson ? "sqlite" : "json";
const homes = [];
const newHome = () => { const h = mkdtempSync(join(tmpdir(), "ki-db-")); homes.push(h); return h; };
test.after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

// Runs a small script in a fresh process (a fresh process is a fresh start of KI) and returns what it printed.
const run = (home, code, env = {}) => {
  const r = spawnSync("node", ["--input-type=module", "-e", code], { env: { ...process.env, HOME: home, ...env }, encoding: "utf8", cwd: process.cwd() });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const IMPORT = 'import { makeStore, engine, listNames } from "./src/db.mjs";';

test("engine is the database when node:sqlite exists, else the JSON files", () => {
  const h = newHome();
  assert.equal(run(h, IMPORT + "console.log(engine())"), expected);
  assert.equal(run(h, IMPORT + "console.log(engine())", { KI_STORAGE: "json" }), "json");
});

test("a store keeps arrays and objects; a missing store gives the fallback", () => {
  const h = newHome();
  const out = run(h, IMPORT + `
    const a = makeStore("colors"), b = makeStore("data-x");
    a.save([{ id: "1" }]); b.save({ k: { doc: { n: 1 } } });
    console.log(JSON.stringify([a.load(), b.load({}), makeStore("nope").load(), makeStore("nope").load({})]));`);
  assert.equal(out, JSON.stringify([[{ id: "1" }], { k: { doc: { n: 1 } } }, [], {}]));
  if (expected === "sqlite") {
    assert.ok(existsSync(dbPath(h)));
    assert.equal(statSync(dbPath(h)).mode & 0o777, 0o600);
  }
});

test("data is saved for the next start", async () => {
  const h = newHome();
  run(h, IMPORT + 'makeStore("scans").save([{ id: "s1" }])');
  assert.equal(run(h, IMPORT + "console.log(JSON.stringify(makeStore('scans').load()))"), '[{"id":"s1"}]');
  assert.equal(JSON.parse(await readStored(h, "scans"))[0].id, "s1");
});

test("old ~/.ki-*.json files are copied in once and left untouched", () => {
  const h = newHome();
  writeFileSync(join(h, ".ki-colors.json"), '[{"id":"old"}]');
  writeFileSync(join(h, ".ki-data-notes.json"), '{"a":{"doc":{"t":1}}}');
  writeFileSync(join(h, ".ki-scans.json"), "{broken");
  const first = run(h, IMPORT + "console.log(JSON.stringify([makeStore('colors').load(), makeStore('data-notes').load({}), makeStore('scans').load(), listNames('data-')]))");
  assert.equal(first, JSON.stringify([[{ id: "old" }], { a: { doc: { t: 1 } } }, [], ["data-notes"]]));
  assert.equal(readFileSync(join(h, ".ki-colors.json"), "utf8"), '[{"id":"old"}]');
  if (expected !== "sqlite") return;
  // the database is now the owner: a changed old file must not overwrite newer data
  run(h, IMPORT + "makeStore('colors').save([{ id: 'new' }])");
  writeFileSync(join(h, ".ki-colors.json"), '[{"id":"older-again"}]');
  assert.equal(run(h, IMPORT + "console.log(JSON.stringify(makeStore('colors').load()))"), '[{"id":"new"}]');
});

test("backup copies the database (or JSON files) and the uploaded files", async () => {
  const h = newHome();
  run(h, IMPORT + "makeStore('colors').save([{ id: 'b1' }])");
  const files = join(h, ".ki", "files");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "abc"), "bytes");
  const dest = join(h, "bk");
  const r = spawnSync("node", ["scripts/backup.mjs", dest], { env: { ...process.env, HOME: h }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dest, "files", "abc"), "utf8"), "bytes");
  if (expected === "sqlite") {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(join(dest, "ki.db"));
    assert.match(d.prepare("SELECT value FROM kv WHERE name = 'colors'").get().value, /b1/);
    d.close();
  } else {
    assert.match(readFileSync(join(dest, ".ki-colors.json"), "utf8"), /b1/);
  }
});


test("JSON backup includes uploaded-file metadata and bytes", () => {
  const h = newHome();
  const dest = join(h, "json-backup");

  run(h, IMPORT + `
    makeStore("files").save([
      { id: "abc123", name: "photo.jpg", size: 5, type: "image/jpeg" }
    ]);
    console.log("OK");
  `, { KI_STORAGE: "json" });

  const dir = join(h, ".ki", "files");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "abc123"), "bytes");

  const r = spawnSync("node", ["scripts/backup.mjs", dest], {
    env: { ...process.env, HOME: h, KI_STORAGE: "json" },
    encoding: "utf8"
  });

  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    JSON.parse(readFileSync(join(dest, ".ki-files.json"), "utf8")),
    [{ id: "abc123", name: "photo.jpg", size: 5, type: "image/jpeg" }]
  );
  assert.equal(readFileSync(join(dest, "files", "abc123"), "utf8"), "bytes");
});
