import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scopeOf } from "../src/keys.mjs";

const UP = 5981, KI = 5982, KI_NO = 5983;
const TOKEN = "ki-v1-token";
const MB = 1024 * 1024;
const home = mkdtempSync(join(tmpdir(), "ki-v1-"));
const svc = (id, extra = {}) => ({ id, name: id, type: "x", base_url: `http://127.0.0.1:${UP}`, enabled: true, auth: "none", ...extra });
const apis = { apis: [
  svc("ai-backend", { auth: "header", auth_header: "x-api-key", env_key: "KHOEM_API_KEY" }),
  svc("cidc-api", { auth: "bearer", env_key: "CIDC_TOKEN" }),
  svc("ei-t"),
  svc("iqai-media", { base_url: `http://127.0.0.1:${UP}/api/v1`, auth: "bearer", env_key: "IQAI_TOKEN" }),
  svc("khoem-ai-api"),
  svc("ksv-gateway", { auth: "header", auth_header: "x-gateway-token", env_key: "KSV_GATEWAY_TOKEN" }),
] };
let upstream;
const seen = [];
const procs = [];

const start = async (port, env) => {
  const file = join(home, "apis.json");
  writeFileSync(file, JSON.stringify(apis));
  const p = spawn("node", ["src/server.mjs"], {
    env: { ...process.env, HOME: home, PORT: String(port), KI_ENV_FILE: "/nonexistent", KI_APIS_FILE: file, KHOEM_API_KEY: "secret-ai", CIDC_TOKEN: "secret-cidc", IQAI_TOKEN: "secret-iqai", KSV_GATEWAY_TOKEN: "secret-ksv", ...env },
    stdio: "ignore",
  });
  procs.push(p);
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("KI did not start");
};

before(async () => {
  upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });
  }).listen(UP, "127.0.0.1");
  await start(KI, { KI_API_TOKEN: TOKEN });
  await start(KI_NO, { KI_API_TOKEN: "" });
});
after(() => { for (const p of procs) p.kill(); upstream?.close(); rmSync(home, { recursive: true, force: true }); });

const v1 = (path, init = {}) => fetch(`http://127.0.0.1:${KI}/v1${path}`, { ...init, headers: { "x-ki-token": TOKEN, ...(init.headers ?? {}) } });
const json = (method, path, body) => v1(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("/v1 needs the KI token and refuses to run without KI_API_TOKEN", async () => {
  assert.equal((await fetch(`http://127.0.0.1:${KI}/v1`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${KI_NO}/v1`)).status, 503);
});

test("index lists the routes; unknown route is 404", async () => {
  const r = await v1("");
  assert.equal(r.status, 200);
  assert.ok((await r.json()).routes.includes("POST /v1/chat"));
  assert.equal((await v1("/nope")).status, 404);
  assert.equal((await v1("", { method: "POST" })).status, 405);
});

test("aliases go through the gateway with the module's own credential", async () => {
  let r = await json("POST", "/chat", { message: "hi" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, "/api/chat");
  assert.equal(seen.at(-1).headers["x-api-key"], "secret-ai");
  assert.equal(seen.at(-1).headers["x-ki-token"], undefined);
  assert.equal((await (await v1("/models")).json()).url, "/api/models");
  assert.equal((await (await json("POST", "/translate", {})).json()).url, "/api/translate");
  assert.equal((await (await json("POST", "/math", {})).json()).url, "/v1/call");
  assert.equal((await (await v1("/audio/voices?x=1")).json()).url, "/api/v1/audio/voices?x=1");
  assert.equal(seen.at(-1).headers.authorization, "Bearer secret-iqai");
  assert.equal((await (await json("POST", "/search", {})).json()).url, "/api/cidc/search");
});

test("aliases keep the gateway allowlist (default deny)", async () => {
  assert.equal((await v1("/chat")).status, 403);
  assert.equal((await v1("/audio/x", { method: "DELETE" })).status, 403);
  assert.equal((await json("POST", "/models", {})).status, 403);
});

test("files: upload, list, download, delete", async () => {
  const buf = Buffer.from("សួស្តី KHOEM-AI\n\u0000\u0001binary");
  let r = await v1("/files?name=../../evil name?.txt", { method: "POST", headers: { "Content-Type": "text/plain" }, body: buf });
  assert.equal(r.status, 200);
  const { file } = await r.json();
  assert.match(file.id, /^[a-f0-9]{24}$/);
  assert.equal(file.size, buf.length);
  assert.equal(file.name, "evil name_.txt");
  assert.ok((await (await v1("/files")).json()).files.some((f) => f.id === file.id));
  r = await v1("/files/" + file.id);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-disposition"), /^attachment/);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(buf));
  assert.equal((await v1("/files/" + file.id, { method: "DELETE" })).status, 200);
  assert.equal((await v1("/files/" + file.id)).status, 404);
});

test("files: developer keys can only access their own files", async () => {
  const createA = await json("POST", "/keys", { name: "files-A", scopes: ["files"] });
  const createB = await json("POST", "/keys", { name: "files-B", scopes: ["files"] });
  assert.equal(createA.status, 200);
  assert.equal(createB.status, 200);

  const a = (await createA.json()).key;
  const b = (await createB.json()).key;

  const asKey = (key, path, init = {}) => fetch(
    `http://127.0.0.1:${KI}/v1${path}`,
    { ...init, headers: { "x-ki-key": key, ...(init.headers ?? {}) } }
  );

  const uploadA = await asKey(a, "/files?name=A.txt", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "File A"
  });
  const uploadB = await asKey(b, "/files?name=B.txt", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: "File B"
  });

  assert.equal(uploadA.status, 200);
  assert.equal(uploadB.status, 200);

  const fileA = (await uploadA.json()).file;
  const fileB = (await uploadB.json()).file;

  const listA = await (await asKey(a, "/files")).json();
  const listB = await (await asKey(b, "/files")).json();

  assert.deepEqual(listA.files.map(f => f.id), [fileA.id]);
  assert.deepEqual(listB.files.map(f => f.id), [fileB.id]);

  assert.equal((await asKey(a, "/files/" + fileB.id)).status, 404);
  assert.equal((await asKey(a, "/files/" + fileB.id, { method: "DELETE" })).status, 404);
  assert.equal((await asKey(b, "/files/" + fileB.id)).status, 200);

  const masterFiles = await (await v1("/files")).json();
  assert.ok(masterFiles.files.some(f => f.id === fileA.id));
  assert.ok(masterFiles.files.some(f => f.id === fileB.id));

  assert.equal((await asKey(a, "/files/" + fileA.id, { method: "DELETE" })).status, 200);
  assert.equal((await asKey(b, "/files/" + fileB.id, { method: "DELETE" })).status, 200);
});

test("files: bad id is 400, over 20 MB is 413, stored in the home folder only", async () => {
  assert.equal((await v1("/files/..%2f..%2fetc")).status, 400);
  assert.equal((await v1("/files/abc")).status, 400);
  let status;
  try { status = (await v1("/files", { method: "POST", body: Buffer.alloc(21 * MB) })).status; } catch { status = 413; }
  assert.equal(status, 413);
  assert.ok(existsSync(join(home, ".ki", "files")));
});

test("data: put, get, list, update, delete", async () => {
  assert.equal((await json("PUT", "/data/notes/n1", { title: "a" })).status, 200);
  assert.equal((await json("PUT", "/data/notes/n1", { title: "b" })).status, 200);
  let r = await (await v1("/data/notes/n1")).json();
  assert.deepEqual(r.doc, { title: "b" });
  r = await (await v1("/data/notes")).json();
  assert.equal(r.count, 1);
  assert.deepEqual((await (await v1("/data")).json()).collections, ["notes"]);
  assert.equal((await v1("/data/notes/n1", { method: "DELETE" })).status, 200);
  assert.equal((await v1("/data/notes/n1")).status, 404);
  assert.equal((await v1("/data/notes/n1", { method: "DELETE" })).status, 404);
});

test("data: bad names and bodies are refused", async () => {
  assert.equal((await json("PUT", "/data/Bad_Name/x", {})).status, 400);
  assert.equal((await json("PUT", "/data/notes/__proto__", {})).status, 400);
  assert.equal((await json("PUT", "/data/notes/a b", {})).status, 400);
  assert.equal((await json("PUT", "/data/notes/x", [1])).status, 400);
  assert.equal((await v1("/data/notes/x", { method: "PUT", body: "{oops" })).status, 400);
  assert.equal((await v1("/data/notes/x", { method: "PUT", body: "x".repeat(70 * 1024) })).status, 413);
  assert.equal((await v1("/data/notes/a/b")).status, 400);
});

test("ksv alias: GET only, KSV token added by KI, device control not reachable, no developer-key scope", async () => {
  const r = await v1("/ksv", { headers: { "x-gateway-token": "evil" } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, "/api");
  assert.equal(seen.at(-1).headers["x-gateway-token"], "secret-ksv");
  assert.equal((await json("POST", "/ksv", {})).status, 403);
  assert.equal((await v1("/ksv/api/ksv")).status, 404);
  assert.equal(scopeOf("/v1/ksv"), null);
});
