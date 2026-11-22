// KI gateway (/gw/<service>/...): one front door to the other KHOEM-AI services.
// Own services only: every upstream must be on loopback. Default deny: only routes listed in SERVICES are forwarded.
// Upstream credentials (env_key in data/apis.json) stay on the server; callers only need x-ki-token.
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APIS_FILE = process.env.KI_APIS_FILE ?? fileURLToPath(new URL("../data/apis.json", import.meta.url));
const MB = 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

// URL alias -> id in data/apis.json. "/x/*" matches any path under /x/.
const SERVICES = {
  cidc: {
    api: "cidc-api", prefix: "/api/cidc", maxBody: MB, timeoutMs: 15_000,
    allow: [["GET", "/*"], ["POST", "/search"], ["POST", "/retrieve"]],
  },
  "ei-t": {
    api: "ei-t", maxBody: 64 * 1024, timeoutMs: 15_000,
    allow: [["GET", "/health"], ["GET", "/v1/functions"], ["POST", "/v1/call"]],
  },
  iqai: {
    api: "iqai-media", maxBody: 60 * MB, timeoutMs: 600_000,
    allow: [
      ["GET", "/health"],
      ["GET", "/audio/*"], ["POST", "/audio/*"],
      ["GET", "/videos/*"], ["POST", "/videos/*"],
      ["GET", "/media"], ["POST", "/media"], ["GET", "/media/*"],
      ["GET", "/projects"], ["POST", "/projects"], ["GET", "/projects/*"], ["PUT", "/projects/*"], ["DELETE", "/projects/*"],
    ],
  },
  lang: {
    api: "khoem-ai-api", maxBody: MB, timeoutMs: 15_000,
    allow: [["GET", "/health"], ["GET", "/api/languages"], ["GET", "/api/locales"], ["GET", "/api/coverage"], ["POST", "/api/translate"]],
  },
};

const PASS_REQ = ["content-type", "content-length", "accept", "accept-language", "range"];
const PASS_RES = ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "cache-control", "x-applied"];

const loadApis = () => JSON.parse(readFileSync(APIS_FILE, "utf8")).apis ?? [];

// Looks up the upstream; returns { error } when it must not be used.
function resolve(alias) {
  const svc = SERVICES[alias];
  const api = loadApis().find((a) => a.id === svc.api);
  if (!api) return { svc, error: "service is not in the registry" };
  if (api.enabled === false) return { svc, error: "service is disabled in the registry" };
  let u;
  try { u = new URL(api.base_url); } catch { return { svc, error: "bad base_url in the registry" }; }
  if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) return { svc, error: "upstream is not loopback (own services only)" };
  const headers = {};
  if (api.auth === "bearer" || api.auth === "header") {
    const key = api.env_key ? process.env[api.env_key] : "";
    if (!key) return { svc, error: `credential ${api.env_key || "env_key"} is not set in ~/KI/.env` };
    if (api.auth === "bearer") headers.authorization = "Bearer " + key;
    else headers[String(api.auth_header || "x-api-key").toLowerCase()] = key;
  }
  return { svc, u, headers };
}

// Decoded path must be plain: no dot segments, no encoded slashes, no empty segments.
function cleanSub(raw) {
  if (/%2f|%5c|%00/i.test(raw)) return null;
  let p;
  try { p = decodeURIComponent(raw); } catch { return null; }
  if (/[\0\\]/.test(p) || p.includes("//")) return null;
  if (p.split("/").some((s) => s === ".." || s === ".")) return null;
  return p;
}

const allowed = (svc, method, sub) =>
  svc.allow.some(([m, pat]) => m === method && (pat === sub || (pat.endsWith("/*") && sub.startsWith(pat.slice(0, -1)))));

// Returns true when the request belongs to the gateway (it then answers it).
export function handleGateway(req, res, send, { tokenSet }) {
  const url = req.url ?? "/";
  const q = url.indexOf("?");
  const raw = (q < 0 ? url : url.slice(0, q)).replace(/\/+$/, "") || "/";
  const query = q < 0 ? "" : url.slice(q);
  if (raw !== "/gw" && !raw.startsWith("/gw/")) return false;
  try {
    // Without a KI token the gateway would be open to any web page on the phone.
    if (!tokenSet) { send(res, 503, { error: "gateway needs KI_API_TOKEN in ~/KI/.env" }); return true; }

    if (raw === "/gw") {
      if (req.method !== "GET") { send(res, 405, { error: "method not allowed" }); return true; }
      const services = Object.entries(SERVICES).map(([alias, s]) => {
        const r = resolve(alias);
        return { service: alias, api: s.api, ready: !r.error, ...(r.error ? { problem: r.error } : {}), routes: s.allow.map(([m, p]) => m + " " + p) };
      });
      send(res, 200, { services });
      return true;
    }

    const m = /^\/gw\/([a-z0-9-]+)(\/.*)?$/.exec(raw);
    if (!m || !Object.hasOwn(SERVICES, m[1])) { send(res, 404, { error: "unknown service" }); return true; }
    const alias = m[1];
    const rawSub = m[2] ?? "/";
    const sub = cleanSub(rawSub);
    if (sub === null) { send(res, 400, { error: "bad path" }); return true; }
    if (!allowed(SERVICES[alias], req.method ?? "", sub)) { send(res, 403, { error: "route not allowed" }); return true; }
    const r = resolve(alias);
    if (r.error) { send(res, 503, { error: r.error, service: alias }); return true; }

    // After refusing a body we keep reading (and dropping) it so the caller can see the answer; hard stop at drainCap.
    let n = 0;
    const drainCap = Math.max(2 * r.svc.maxBody, 16 * MB);
    const len = Number(req.headers["content-length"] ?? 0);
    if (len > r.svc.maxBody) {
      send(res, 413, { error: "body too large", service: alias });
      req.on("data", (c) => { n += c.length; if (n > drainCap) req.destroy(); });
      return true;
    }

    const headers = {};
    for (const k of PASS_REQ) if (req.headers[k] !== undefined) headers[k] = req.headers[k];
    Object.assign(headers, r.headers); // upstream credentials always win over anything the caller sent
    let up;
    try {
      up = http.request({
        hostname: r.u.hostname, port: r.u.port || 80, method: req.method,
        path: r.u.pathname.replace(/\/+$/, "") + (r.svc.prefix ?? "") + rawSub + query, headers,
      });
    } catch { send(res, 400, { error: "bad request" }); return true; }

    let done = false;
    let timedOut = false;
    const fail = (code, msg) => {
      if (done) return;
      done = true;
      if (!res.headersSent) send(res, code, { error: msg, service: alias });
      else res.destroy();
    };
    up.setTimeout(r.svc.timeoutMs, () => { timedOut = true; up.destroy(); });
    up.on("error", () => fail(timedOut ? 504 : 502, timedOut ? "upstream timeout" : "upstream unreachable"));
    up.on("response", (ur) => {
      const out = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-Applied, Content-Disposition, Content-Range",
        "X-Content-Type-Options": "nosniff",
      };
      for (const k of PASS_RES) if (ur.headers[k] !== undefined) out[k] = ur.headers[k];
      res.writeHead(ur.statusCode ?? 502, out);
      ur.on("error", () => res.destroy());
      ur.on("end", () => { done = true; });
      ur.pipe(res);
    });
    res.on("close", () => { if (!res.writableFinished) up.destroy(); });

    req.on("data", (c) => {
      n += c.length;
      if (done) { if (n > drainCap) req.destroy(); return; }
      if (n > r.svc.maxBody) {
        req.unpipe(up);
        up.destroy();
        fail(413, "body too large");
      }
    });
    req.pipe(up);
    return true;
  } catch {
    if (!res.headersSent) send(res, 500, { error: "gateway error" });
    return true;
  }
}
