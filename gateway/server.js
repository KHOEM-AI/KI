import express from "express";
import { registry, local } from "./registry.js";
const app = express();
app.use(express.json({ limit: "20mb" }));


// ===== Anthropic proxy: key នៅ gateway តែប៉ុណ្ណោះ =====
const A_MODEL = "claude-sonnet-4-6";
let aCount = 0;
setInterval(() => { aCount = 0; }, 60000);
app.use("/api/anthropic", (req, res, next) => {
  const o = req.get("origin") || "";
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) res.set("Access-Control-Allow-Origin", o);
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.post("/api/anthropic", async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: "ANTHROPIC_API_KEY មិនទាន់កំណត់" });
  if (++aCount > 30) return res.status(429).json({ error: "ច្រើនពេក សូមរង់ចាំ" });
  const b = req.body || {};
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: A_MODEL, max_tokens: Math.min(Number(b.max_tokens) || 1024, 1024), messages: b.messages }),
    });
    res.status(r.status).set("Content-Type", "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

// ===== ការពារ៖ token + allowlist =====
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || "";
const SAFE = [
  /^ai\/api\/(health|models|status|chat)$/,
  /^khoem\/(health|languages|knowledge|translate)$/,
];
const DANGEROUS = /(kill|resume|approvals|execute|control)/i;
app.use("/api", (req, res, next) => {
  if (req.path === "/" ) return next();
  if (!GATEWAY_TOKEN) return res.status(503).json({ error: "GATEWAY_TOKEN មិនទាន់កំណត់" });
  if (req.get("x-gateway-token") !== GATEWAY_TOKEN) return res.status(401).json({ error: "unauthorized" });
  if (req.path.startsWith("/local/")) {
    const rest = req.path.replace(/^\/local\//, "").replace(/\/+$/, "");
    if (DANGEROUS.test(rest) || !SAFE.some((r) => r.test(rest)))
      return res.status(403).json({ error: "path មិនត្រូវបានអនុញ្ញាត" });
  }
  next();
});

app.get("/api", (_req, res) => res.json({ external: Object.keys(registry), local: Object.keys(local) }));

async function forward(url, req, res, extra = {}) {
  try {
    const headers = { "Content-Type": "application/json", ...extra };
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const r = await fetch(url, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined });
    res.status(r.status).set("Content-Type", r.headers.get("content-type") || "application/json").send(await r.text());
  } catch (e) { res.status(502).json({ error: String(e) }); }
}

// API ផ្ទាល់ខ្លួន៖ /api/local/<name>/<path...>
app.all("/api/local/:name/*path", (req, res) => {
  const base = local[req.params.name];
  if (!base) return res.status(404).json({ error: "មិនមាន" });
  const qs = new URLSearchParams(req.query).toString();
  forward(base + "/" + [].concat(req.params.path).join("/") + (qs ? "?" + qs : ""), req, res);
});

// API ខាងក្រៅ៖ /api/<name>
app.all("/api/:name", (req, res) => {
  const api = registry[req.params.name];
  if (!api) return res.status(404).json({ error: "API មិនមាន" });
  const qs = new URLSearchParams(req.query).toString();
  const extra = { ...(api.extraHeaders || {}) };
  if (api.keyEnv && process.env[api.keyEnv]) extra["x-api-key"] = process.env[api.keyEnv];
  forward(api.target + (qs ? "?" + qs : ""), req, res, extra);
});

app.listen(process.env.PORT || 4000, "127.0.0.1", () => console.log("KI gateway រត់"));
