// KI API (:5001) - plain Node, no dependencies.
// Routes: GET /api/healthz | GET,POST /api/colors | GET,POST /api/scans | POST /api/scan (AI vision: not configured)
import http from "node:http";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

const HOME = process.env.HOME ?? ".";
const PORT = Number(process.env.PORT ?? 5001);
const MAX_BODY = 8 * 1024 * 1024;

const store = (name) => {
  const f = `${HOME}/.ki-${name}.json`;
  return {
    load() {
      try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : []; } catch { return []; }
    },
    save(a) { writeFileSync(f + ".tmp", JSON.stringify(a)); renameSync(f + ".tmp", f); },
  };
};
const colors = store("colors");
const scans = store("scans");

const send = (res, code, obj) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
};

const readJson = (req) => new Promise((ok, no) => {
  let n = 0; const parts = [];
  req.on("data", (c) => { n += c.length; if (n > MAX_BODY) { no(new Error("too large")); req.destroy(); } else parts.push(c); });
  req.on("end", () => { try { ok(JSON.parse(Buffer.concat(parts).toString("utf8") || "null")); } catch { no(new Error("bad json")); } });
  req.on("error", no);
});

const upsert = (st, item, limit) => {
  const a = st.load().filter((x) => x.id !== item.id);
  a.push(item);
  st.save(a.slice(-limit));
  return a.length;
};

const routes = {
  "GET /api/healthz": async (_req, res) => send(res, 200, { ok: true, service: "ki" }),
  "GET /api/colors": async (_req, res) => send(res, 200, { palettes: colors.load() }),
  "POST /api/colors": async (req, res) => {
    const p = await readJson(req);
    if (!p || typeof p.id !== "string" || p.id.length > 64 || !Array.isArray(p.cols) || p.cols.length > 64)
      return send(res, 400, { error: "bad palette" });
    send(res, 200, { ok: true, count: upsert(colors, p, 200) });
  },
  "GET /api/scans": async (_req, res) => send(res, 200, { scans: scans.load() }),
  "POST /api/scans": async (req, res) => {
    const s = await readJson(req);
    if (!s || typeof s.id !== "string" || s.id.length > 64 ||
        typeof s.counts !== "object" || s.counts === null || Array.isArray(s.counts) ||
        Object.keys(s.counts).length > 200)
      return send(res, 400, { error: "bad scan" });
    const item = { id: s.id, time: s.time ?? null, name: s.name ?? null, gps: s.gps ?? null, counts: s.counts };
    send(res, 200, { ok: true, count: upsert(scans, item, 500) });
  },
  "POST /api/scan": async (_req, res) => send(res, 501, { error: "AI vision not configured in KI yet" }),
};

http.createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (req.method === "OPTIONS") return send(res, 204, {});
  const h = routes[`${req.method} ${path}`];
  if (!h) return send(res, 404, { error: "not found" });
  try { await h(req, res); } catch (e) { send(res, e.message === "too large" ? 413 : 400, { error: e.message }); }
}).listen(PORT, "127.0.0.1", () => console.log(`KI API listening on :${PORT}`));
