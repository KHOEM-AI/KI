// KI storage: ONE place for all KI data.
//  - Engine "sqlite": a single file ~/.ki/ki.db (Node's built-in node:sqlite, no dependency). Uploaded file bytes live next to it in ~/.ki/files/.
//  - Engine "json": the older layout (~/.ki-<name>.json), used when node:sqlite is missing or KI_STORAGE=json.
// A store is a named JSON value: makeStore("colors").load([]) / .save(value). On the first sqlite start the old
// ~/.ki-*.json files are copied in once (they are never deleted or changed, so they stay as a backup).
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, chmodSync, statSync, cpSync } from "node:fs";
import { dirname } from "node:path";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch { /* old Node: JSON engine */ }

const home = () => process.env.HOME ?? ".";
export const root = () => `${home()}/.ki`;
const dbPath = () => process.env.KI_DB_FILE ?? `${root()}/ki.db`;
const LEGACY = /^\.ki-(colors|scans|notifications|keys|files|data-[a-z0-9-]+)\.json$/;

let db = null, openedPath = null, failedPath = null;

function importLegacy(d) {
  const has = d.prepare("SELECT 1 FROM kv WHERE name = ?");
  const put = d.prepare("INSERT INTO kv(name, value, updated) VALUES(?, ?, ?)");
  let files = [];
  try { files = readdirSync(home()); } catch { /* no home */ }
  d.exec("BEGIN");
  try {
    for (const f of files) {
      const name = LEGACY.exec(f)?.[1];
      if (!name || has.get(name)) continue;
      try {
        const text = readFileSync(`${home()}/${f}`, "utf8");
        JSON.parse(text);
        put.run(name, text, new Date().toISOString());
      } catch { /* unreadable or broken old file: skip it, leave it alone */ }
    }
    d.exec("COMMIT");
  } catch (e) { d.exec("ROLLBACK"); throw e; }
}

function open() {
  if (!sqlite || process.env.KI_STORAGE === "json") return null;
  const path = dbPath();
  if (db && openedPath === path) return db;
  if (failedPath === path) return null;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const d = new sqlite.DatabaseSync(path);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;");
    d.exec("CREATE TABLE IF NOT EXISTS kv (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL) WITHOUT ROWID");
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
    importLegacy(d);
    db = d; openedPath = path;
    return d;
  } catch (e) {
    failedPath = path;
    console.error("KI storage: sqlite unavailable, using JSON files:", e.message);
    return null;
  }
}

export const engine = () => (open() ? "sqlite" : "json");

export function location() {
  return open() ? dbPath().replace(home(), "~") : "~/.ki-<name>.json";
}

export function sizeBytes() {
  try { return open() ? statSync(dbPath()).size : 0; } catch { return 0; }
}

export function makeStore(name) {
  const file = () => `${home()}/.ki-${name}.json`;
  return {
    load(fallback = []) {
      const d = open();
      try {
        if (d) { const row = d.prepare("SELECT value FROM kv WHERE name = ?").get(name); return row ? JSON.parse(row.value) : fallback; }
        return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : fallback;
      } catch { return fallback; }
    },
    save(value) {
      const d = open();
      const text = JSON.stringify(value);
      if (d) {
        d.prepare("INSERT INTO kv(name, value, updated) VALUES(?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated = excluded.updated")
          .run(name, text, new Date().toISOString());
        return;
      }
      writeFileSync(file() + ".tmp", text, { mode: 0o600 });
      renameSync(file() + ".tmp", file());
    },
  };
}

// Names of the stores that start with `prefix` (for example "data-").
export function listNames(prefix) {
  const d = open();
  if (d) return d.prepare("SELECT name FROM kv WHERE substr(name, 1, ?) = ? ORDER BY name").all(prefix.length, prefix).map((r) => r.name);
  let files = [];
  try { files = readdirSync(home()); } catch { /* no home */ }
  return files.map((f) => LEGACY.exec(f)?.[1]).filter((n) => n && n.startsWith(prefix)).sort();
}

// Copies everything KI keeps into `dest` (a new folder): the database (a consistent copy) or the JSON files, plus uploaded files.
export function backupTo(dest) {
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const d = open();
  const copied = [];
  if (d) {
    d.exec(`VACUUM INTO '${`${dest}/ki.db`.replaceAll("'", "''")}'`);
    copied.push("ki.db");
  } else {
    for (const f of readdirSync(home())) if (LEGACY.test(f)) { cpSync(`${home()}/${f}`, `${dest}/${f}`); copied.push(f); }
  }
  if (existsSync(`${root()}/files`)) { cpSync(`${root()}/files`, `${dest}/files`, { recursive: true }); copied.push("files/"); }
  return copied;
}
