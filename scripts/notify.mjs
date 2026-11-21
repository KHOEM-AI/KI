// Send a notification to the local KI. Usage:
//   node ~/KI/scripts/notify.mjs <info|warn|error|critical> <source> "<title>" ["<message>"]
// Talks to 127.0.0.1 only; the token is read from ~/KI/.env.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_FILE = process.env.KI_ENV_FILE ?? fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(ENV_FILE)) { try { process.loadEnvFile(ENV_FILE); } catch { /* run without token */ } }

const [level, source, title, message] = process.argv.slice(2);
if (!level || !source || !title) {
  console.error('usage: notify.mjs <info|warn|error|critical> <source> "<title>" ["<message>"]');
  process.exit(2);
}
const token = process.env.KI_API_TOKEN ?? "";
const r = await fetch(`http://127.0.0.1:${process.env.KI_PORT ?? 5001}/api/notify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { "x-ki-token": token } : {}) },
  body: JSON.stringify({ level, source, title, ...(message ? { message } : {}) }),
}).catch(() => null);
if (!r) { console.error("KI is not running"); process.exit(1); }
const j = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`KI answered ${r.status}: ${j.error ?? ""}`); process.exit(1); }
console.log("sent", j.id);
