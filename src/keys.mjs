// KI developer keys: scoped, revocable keys for apps, in addition to the one master token (x-ki-token).
// A key is sent as header x-ki-key, works only on /v1/<scope> routes, and is rate limited.
// Only a SHA-256 hash is stored (in the KI database, src/db.mjs); the key itself is shown once, at creation.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { makeStore } from "./db.mjs";

export const SCOPES = ["chat", "search", "translate", "math", "media", "files", "data"];
const MAX_KEYS = 50;
const WINDOW_MS = 60_000;
const rateLimit = () => Math.max(1, Number(process.env.KI_KEY_RATE_PER_MIN) || 120);

const store = makeStore("keys");
const sha = (s) => createHash("sha256").update(s).digest();
const hex = (b) => b.toString("hex");

let cache = null;
const keys = () => {
  if (!cache) { const a = store.load([]); cache = Array.isArray(a) ? a : []; }
  return cache;
};
const flush = () => {
  try { store.save(keys()); }
  catch { /* a failing write must never break a request */ }
};
let timer = null;
const flushSoon = () => { if (!timer) { timer = setTimeout(() => { timer = null; flush(); }, 2000); timer.unref(); } };

const view = ({ hash, ...r }) => r; // never return the hash

export const listKeys = () => keys().map(view);

export function createKey(name, scopes) {
  if (typeof name !== "string" || !name.trim() || name.length > 60) throw Object.assign(new Error("name must be 1-60 characters"), { status: 400 });
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => !SCOPES.includes(s)))
    throw Object.assign(new Error("scopes must be a non-empty list of: " + SCOPES.join(", ")), { status: 400 });
  if (keys().filter((k) => !k.revoked).length >= MAX_KEYS) throw Object.assign(new Error("too many active keys"), { status: 409 });
  const raw = "kik_" + randomBytes(32).toString("base64url");
  const rec = {
    id: randomBytes(4).toString("hex"), name: name.trim(), prefix: raw.slice(0, 8), hash: hex(sha(raw)),
    scopes: [...new Set(scopes)], created: new Date().toISOString(), revoked: false, last_used: null, count: 0,
  };
  keys().push(rec);
  flush();
  return { key: raw, record: view(rec) };
}

export function revokeKey(id) {
  const r = keys().find((k) => k.id === id);
  if (!r) return false;
  r.revoked = true;
  flush();
  return true;
}

function find(raw) {
  const h = sha(raw);
  for (const r of keys()) {
    if (r.revoked) continue;
    const b = Buffer.from(r.hash, "hex");
    if (b.length === h.length && timingSafeEqual(b, h)) return r;
  }
  return null;
}

// /v1 path -> scope name ("index" is open to every valid key); null = keys may not use it.
export function scopeOf(path) {
  if (/%|\.\.|\/\//.test(path)) return null;
  if (path === "/v1") return "index";
  const m = /^\/v1\/([a-z]+)(?:\/.*)?$/.exec(path);
  if (!m) return null;
  const rest = path.slice(3 + 1 + m[1].length); // what follows /v1/<word>
  switch (m[1]) {
    case "chat": case "models": return rest === "" ? "chat" : null;
    case "search": case "retrieve": return rest === "" ? "search" : null;
    case "translate": case "languages": return rest === "" ? "translate" : null;
    case "math": return rest === "" || rest === "/functions" ? "math" : null;
    case "audio": case "videos": case "media": case "projects": return "media";
    case "files": return "files";
    case "data": return "data";
    default: return null; // keys, usage, system, unknown: master token only
  }
}

const hits = new Map();
// Checks a key for this request. Returns { rec } or { code, error }. Counts the use.
export function authorizeKey(raw, path) {
  const rec = typeof raw === "string" && raw ? find(raw) : null;
  if (!rec) return { code: 401, error: "unauthorized" };
  const scope = scopeOf(path);
  if (!scope) return { code: 403, error: "a developer key cannot use this route" };
  if (scope !== "index" && !rec.scopes.includes(scope)) return { code: 403, error: `key has no "${scope}" scope` };
  const now = Date.now();
  const h = hits.get(rec.id);
  if (!h || now - h.start >= WINDOW_MS) hits.set(rec.id, { start: now, n: 1 });
  else if (++h.n > rateLimit()) return { code: 429, error: "rate limit exceeded" };
  rec.count++;
  rec.last_used = new Date().toISOString();
  flushSoon();
  return { rec: { id: rec.id, name: rec.name } };
}
