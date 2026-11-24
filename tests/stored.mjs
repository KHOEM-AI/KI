// Test helper: the raw JSON text KI stored under `name`, whichever storage engine runs (database or old JSON file).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function readStored(home, name) {
  const dbFile = join(home, ".ki", "ki.db");
  if (existsSync(dbFile)) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(dbFile);
    try { return d.prepare("SELECT value FROM kv WHERE name = ?").get(name)?.value ?? null; } finally { d.close(); }
  }
  const f = join(home, `.ki-${name}.json`);
  return existsSync(f) ? readFileSync(f, "utf8") : null;
}
export const dbPath = (home) => join(home, ".ki", "ki.db");
