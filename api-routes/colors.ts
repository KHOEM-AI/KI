import { Router, type IRouter } from "express";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const router: IRouter = Router();
const FILE = `${process.env["HOME"] ?? "."}/.ki-colors.json`;

const load = (): { id: string }[] => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
  } catch {
    return [];
  }
};

router.get("/colors", (_req, res): void => {
  res.json({ palettes: load() });
});

router.post("/colors", (req, res): void => {
  const p = req.body;
  if (!p || typeof p.id !== "string" || !Array.isArray(p.cols) || p.cols.length > 64) {
    res.status(400).json({ error: "bad palette" });
    return;
  }
  const a = load().filter((x) => x.id !== p.id);
  a.push(p);
  writeFileSync(FILE, JSON.stringify(a.slice(-200)));
  res.json({ ok: true, count: a.length });
});

export default router;
