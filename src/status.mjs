// GET /api/status: asks every service in data/apis.json whether it answers. Loopback only (own services).
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APIS_FILE = process.env.KI_APIS_FILE ?? fileURLToPath(new URL("../data/apis.json", import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);
const TIMEOUT_MS = 2000;

// ok = 2xx/3xx, up = answers but 4xx (needs login or no such path), error = 5xx, down = no answer.
function probe(api) {
  return new Promise((done) => {
    let u;
    try { u = new URL(api.base_url); } catch { return done({ state: "skipped", why: "bad base_url" }); }
    if (u.protocol !== "http:") return done({ state: "skipped", why: "not http" });
    if (!LOOPBACK.has(u.hostname)) return done({ state: "skipped", why: "not loopback (own services only)" });
    const t0 = Date.now();
    const path = u.pathname.replace(/\/+$/, "") + (api.health ?? "");
    const r = http.get({ hostname: u.hostname, port: u.port || 80, path: path || "/", timeout: TIMEOUT_MS }, (res) => {
      res.resume();
      const c = res.statusCode ?? 0;
      done({ state: c < 400 ? "ok" : c < 500 ? "up" : "error", http: c, ms: Date.now() - t0 });
    });
    r.on("timeout", () => { r.destroy(); done({ state: "down", why: "timeout" }); });
    r.on("error", () => done({ state: "down", why: "unreachable" }));
  });
}

async function run(res, send) {
  const apis = JSON.parse(readFileSync(APIS_FILE, "utf8")).apis ?? [];
  const services = await Promise.all(apis.map(async (a) => ({
    id: a.id, name: a.name ?? a.id,
    ...(a.enabled === false ? { state: "disabled" } : await probe(a)),
  })));
  const summary = {};
  for (const s of services) summary[s.state] = (summary[s.state] ?? 0) + 1;
  send(res, 200, { checked_at: new Date().toISOString(), summary, services });
}

// Returns true when the request is GET /api/status (it then answers it).
export function handleStatus(req, res, send) {
  const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "");
  if (req.method !== "GET" || path !== "/api/status") return false;
  run(res, send).catch(() => { if (!res.headersSent) send(res, 500, { error: "status error" }); });
  return true;
}
