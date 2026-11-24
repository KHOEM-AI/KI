// KI notifications (/api/notify, /api/notifications): services and scripts post events, the UI reads them.
// Own device only: events live in the KI database (src/db.mjs) and are never sent anywhere.
import { randomUUID } from "node:crypto";
import { makeStore } from "./db.mjs";

const store = makeStore("notifications");
const LIMIT = Number.isInteger(Number(process.env.KI_NOTIFY_LIMIT)) && Number(process.env.KI_NOTIFY_LIMIT) > 0 ? Number(process.env.KI_NOTIFY_LIMIT) : 500;
const MAX_BODY = 16 * 1024;
const LEVELS = ["info", "warn", "error", "critical"];
const SOURCE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const ROUTES = new Set(["POST /api/notify", "GET /api/notifications", "POST /api/notifications/read"]);

const load = () => { const a = store.load([]); return Array.isArray(a) ? a : []; };
const save = (a) => store.save(a);

// Over the limit: drop the oldest READ item first, so an unread alert is lost only when everything is unread.
function trim(a) {
  while (a.length > LIMIT) {
    const i = a.findIndex((x) => x.read);
    a.splice(i >= 0 ? i : 0, 1);
  }
  return a;
}

function parse(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const level = b.level ?? "info";
  if (!LEVELS.includes(level)) return null;
  if (typeof b.source !== "string" || !SOURCE.test(b.source)) return null;
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 120) return null;
  if (b.message != null && (typeof b.message !== "string" || b.message.length > 1000)) return null;
  return { level, source: b.source, title: b.title.trim(), message: b.message ?? null };
}

const readJson = (req) => new Promise((ok, no) => {
  let n = 0;
  let big = false;
  const parts = [];
  req.on("data", (c) => {
    n += c.length;
    if (n > 1024 * 1024) req.destroy();
    else if (n > MAX_BODY) big = true; // keep reading so the caller can see the 413
    else parts.push(c);
  });
  req.on("end", () => {
    if (big) return no(new Error("too large"));
    try { ok(JSON.parse(Buffer.concat(parts).toString("utf8") || "null")); } catch { no(new Error("bad json")); }
  });
  req.on("error", no);
  req.on("close", () => no(new Error("aborted")));
});

// Same checks as POST /api/notify. With dedupe, an unread item with the same source and title is not added twice.
// Returns the stored item, or null when the input is bad or was a duplicate.
export function addNotification(input, { dedupe = false } = {}) {
  const n = parse(input);
  if (!n) return null;
  const a = load();
  if (dedupe && a.some((x) => !x.read && x.source === n.source && x.title === n.title)) return null;
  const item = { id: randomUUID(), time: new Date().toISOString(), ...n, read: false };
  a.push(item);
  save(trim(a));
  return item;
}

async function run(req, res, send, key, url) {
  if (key === "POST /api/notify") {
    const item = addNotification(await readJson(req));
    if (!item) return send(res, 400, { error: "bad notification" });
    return send(res, 200, { ok: true, id: item.id });
  }
  if (key === "GET /api/notifications") {
    const q = url.searchParams;
    const all = load();
    let a = all;
    if (q.get("unread") === "1") a = a.filter((x) => !x.read);
    if (q.get("level")) a = a.filter((x) => x.level === q.get("level"));
    if (q.get("source")) a = a.filter((x) => x.source === q.get("source"));
    const limit = Math.min(200, Math.max(1, parseInt(q.get("limit") ?? "50", 10) || 50));
    return send(res, 200, {
      unread: all.filter((x) => !x.read).length, total: all.length,
      notifications: [...a].reverse().slice(0, limit), // newest first
    });
  }
  // POST /api/notifications/read
  const b = await readJson(req);
  if (!b || typeof b !== "object" || Array.isArray(b)) return send(res, 400, { error: "bad body" });
  let ids = null;
  if (b.all !== true) {
    if (!Array.isArray(b.ids) || b.ids.length > 200 || !b.ids.every((x) => typeof x === "string")) return send(res, 400, { error: "send {all:true} or {ids:[...]}" });
    ids = new Set(b.ids);
  }
  const a = load();
  let changed = 0;
  for (const x of a) if (!x.read && (ids === null || ids.has(x.id))) { x.read = true; changed++; }
  if (changed) save(a);
  return send(res, 200, { ok: true, changed });
}

// Returns true when the request belongs to notifications (it then answers it).
export function handleNotify(req, res, send) {
  let url;
  try { url = new URL(req.url ?? "/", "http://ki.local"); } catch { return false; }
  const key = `${req.method} ${url.pathname.replace(/\/+$/, "") || "/"}`;
  if (!ROUTES.has(key)) return false;
  run(req, res, send, key, url).catch((e) => {
    if (res.headersSent) return;
    if (e.message === "too large") send(res, 413, { error: "too large" });
    else if (e.message === "bad json") send(res, 400, { error: "bad json" });
    else send(res, 500, { error: "notification store error" });
  });
  return true;
}
