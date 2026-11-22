// KI /v1: one stable, versioned front door to KHOEM-AI. No dependencies, token required (same x-ki-token).
//  - Aliases to other modules go through the gateway, so its allowlist, loopback rule and credentials still apply.
//  - /v1/files and /v1/data are KI's own storage (in the home folder, never in git).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, statSync, createReadStream } from "node:fs";
import { randomBytes } from "node:crypto";

const MB = 1024 * 1024;
const MAX_FILE = 20 * MB, MAX_FILES = 500;
const MAX_DOC = 64 * 1024, MAX_DOCS = 1000;

// v1 path -> gateway path (the method is passed through; the gateway decides what is allowed).
const EXACT = {
  "/models": "/gw/ai/api/models",
  "/chat": "/gw/ai/api/chat",
  "/search": "/gw/cidc/search",
  "/retrieve": "/gw/cidc/retrieve",
  "/translate": "/gw/lang/api/translate",
  "/languages": "/gw/lang/api/languages",
  "/math": "/gw/ei-t/v1/call",
  "/math/functions": "/gw/ei-t/v1/functions",
};
const PREFIX = {
  "/audio": "/gw/iqai/audio",
  "/videos": "/gw/iqai/videos",
  "/media": "/gw/iqai/media",
  "/projects": "/gw/iqai/projects",
};

const INDEX = {
  version: 1,
  routes: [
    "GET /v1", "GET /v1/models", "POST /v1/chat", "POST /v1/search", "POST /v1/retrieve",
    "POST /v1/translate", "GET /v1/languages", "POST /v1/math", "GET /v1/math/functions",
    "/v1/audio/*", "/v1/videos/*", "/v1/media", "/v1/projects",
    "GET,POST /v1/files", "GET,DELETE /v1/files/<id>",
    "GET /v1/data", "GET /v1/data/<collection>", "GET,PUT,DELETE /v1/data/<collection>/<id>",
  ],
};

const home = () => process.env.HOME ?? ".";
const filesDir = () => `${home()}/.ki-files`;
const dataFile = (c) => `${home()}/.ki-data-${c}.json`;
const COLLECTION = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const FILE_ID = /^[a-f0-9]{24}$/;

const writeAtomic = (f, data) => { writeFileSync(f + ".tmp", data); renameSync(f + ".tmp", f); };
const readJsonFile = (f, fallback) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback; } catch { return fallback; } };

const readBody = (req, max) => new Promise((ok, no) => {
  let n = 0; const parts = [];
  req.on("data", (c) => { n += c.length; if (n > max) { no(new Error("too large")); req.destroy(); } else parts.push(c); });
  req.on("end", () => ok(Buffer.concat(parts)));
  req.on("error", no);
});
const tooBig = (req, max) => Number(req.headers["content-length"] ?? 0) > max;
const readDoc = async (req) => {
  const b = await readBody(req, MAX_DOC);
  try { return JSON.parse(b.toString("utf8") || "null"); } catch { throw new Error("bad json"); }
};

const safeName = (s) => {
  const base = String(s ?? "").split(/[\\/]/).pop().replace(/[^\w.\- ]/g, "_").replace(/^\.+/, "").slice(0, 100).trim();
  return base || "file";
};
const safeType = (s) => (/^[\w.+-]{1,60}\/[\w.+-]{1,60}$/.test(String(s ?? "")) ? String(s) : "application/octet-stream");

// ---------- /v1/files ----------
async function files(req, res, send, sub, query) {
  const dir = filesDir();
  if (sub === "/files") {
    if (req.method === "GET") {
      const items = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJsonFile(`${dir}/${f}`, null)).filter(Boolean)
        : [];
      items.sort((a, b) => String(b.created).localeCompare(String(a.created)));
      return send(res, 200, { files: items.slice(0, MAX_FILES) });
    }
    if (req.method === "POST") {
      if (tooBig(req, MAX_FILE)) { res.once("finish", () => req.destroy()); return send(res, 413, { error: "file too large (max 20 MB)" }); }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (readdirSync(dir).filter((f) => f.endsWith(".json")).length >= MAX_FILES) return send(res, 409, { error: "file store is full" });
      const body = await readBody(req, MAX_FILE);
      const id = randomBytes(12).toString("hex");
      const meta = {
        id, name: safeName(new URLSearchParams(query).get("name")), size: body.length,
        type: safeType(req.headers["content-type"]), created: new Date().toISOString(),
      };
      writeAtomic(`${dir}/${id}.bin`, body);
      writeAtomic(`${dir}/${id}.json`, JSON.stringify(meta));
      return send(res, 200, { ok: true, file: meta });
    }
    return send(res, 405, { error: "method not allowed" });
  }
  const id = sub.slice("/files/".length);
  if (!FILE_ID.test(id)) return send(res, 400, { error: "bad file id" });
  const meta = readJsonFile(`${dir}/${id}.json`, null);
  if (!meta || !existsSync(`${dir}/${id}.bin`)) return send(res, 404, { error: "file not found" });
  if (req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": meta.type, "Content-Length": statSync(`${dir}/${id}.bin`).size,
      "Content-Disposition": `attachment; filename="${meta.name}"`,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox",
      "Access-Control-Allow-Origin": "*",
    });
    return createReadStream(`${dir}/${id}.bin`).on("error", () => res.destroy()).pipe(res);
  }
  if (req.method === "DELETE") {
    unlinkSync(`${dir}/${id}.bin`); unlinkSync(`${dir}/${id}.json`);
    return send(res, 200, { ok: true, deleted: id });
  }
  return send(res, 405, { error: "method not allowed" });
}

// ---------- /v1/data ----------
async function data(req, res, send, sub) {
  if (sub === "/data") {
    if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
    const names = readdirSync(home()).map((f) => /^\.ki-data-(.+)\.json$/.exec(f)?.[1]).filter((c) => c && COLLECTION.test(c));
    return send(res, 200, { collections: names.sort() });
  }
  const [, , c, id, extra] = sub.split("/");
  if (extra !== undefined || !COLLECTION.test(c ?? "")) return send(res, 400, { error: "bad collection name" });
  const f = dataFile(c);
  const load = () => new Map(Object.entries(readJsonFile(f, {})));
  const save = (m) => writeAtomic(f, JSON.stringify(Object.fromEntries(m)));
  if (id === undefined) {
    if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
    const items = [...load()].map(([k, v]) => ({ id: k, ...v }));
    return send(res, 200, { collection: c, count: items.length, items });
  }
  if (!DOC_ID.test(id)) return send(res, 400, { error: "bad document id" });
  const m = load();
  if (req.method === "GET") {
    if (!m.has(id)) return send(res, 404, { error: "not found" });
    return send(res, 200, { id, ...m.get(id) });
  }
  if (req.method === "PUT") {
    if (tooBig(req, MAX_DOC)) { res.once("finish", () => req.destroy()); return send(res, 413, { error: "document too large (max 64 KB)" }); }
    const doc = await readDoc(req);
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return send(res, 400, { error: "document must be a JSON object" });
    if (!m.has(id) && m.size >= MAX_DOCS) return send(res, 409, { error: "collection is full" });
    m.set(id, { doc, updated: new Date().toISOString() });
    save(m);
    return send(res, 200, { ok: true, id });
  }
  if (req.method === "DELETE") {
    if (!m.delete(id)) return send(res, 404, { error: "not found" });
    save(m);
    return send(res, 200, { ok: true, deleted: id });
  }
  return send(res, 405, { error: "method not allowed" });
}

// Returns true when the request belongs to /v1 (it then answers it). `gateway` is handleGateway.
export function handleV1(req, res, send, { tokenSet, gateway }) {
  const url = req.url ?? "/";
  const q = url.indexOf("?");
  const path = (q < 0 ? url : url.slice(0, q)).replace(/\/+$/, "") || "/";
  const query = q < 0 ? "" : url.slice(q);
  if (path !== "/v1" && !path.startsWith("/v1/")) return false;
  if (!tokenSet) { send(res, 503, { error: "/v1 needs KI_API_TOKEN in ~/KI/.env" }); return true; }
  const sub = path.slice(3) || "/";

  if (sub === "/") {
    send(res, req.method === "GET" ? 200 : 405, req.method === "GET" ? INDEX : { error: "method not allowed" });
    return true;
  }
  if (Object.hasOwn(EXACT, sub)) { req.url = EXACT[sub] + query; return gateway(req, res, send, { tokenSet }); }
  for (const [p, target] of Object.entries(PREFIX)) {
    if (sub === p || sub.startsWith(p + "/")) { req.url = target + sub.slice(p.length) + query; return gateway(req, res, send, { tokenSet }); }
  }

  const own = sub === "/files" || sub.startsWith("/files/") ? () => files(req, res, send, sub, query)
    : sub === "/data" || sub.startsWith("/data/") ? () => data(req, res, send, sub)
    : null;
  if (!own) { send(res, 404, { error: "unknown /v1 route" }); return true; }
  own().catch((e) => {
    if (res.headersSent) return res.destroy();
    send(res, e.message === "too large" ? 413 : e.message === "bad json" ? 400 : 500, { error: e.message === "too large" || e.message === "bad json" ? e.message : "storage error" });
  });
  return true;
}
