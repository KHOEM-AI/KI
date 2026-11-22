import { appendFileSync, statSync, renameSync } from "node:fs";

// Access log: one JSON line per request (time, method, path, status, ms, and the developer key id when one was used). Never headers, body, query or tokens.
const MAX_BYTES = 2 * 1024 * 1024;

export function makeAccessLog(home) {
  const file = `${home}/.ki-access.jsonl`;
  return (method, path, status, ms, key) => {
    try {
      try { if (statSync(file).size > MAX_BYTES) renameSync(file, file + ".1"); } catch { /* no file yet */ }
      appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), m: String(method), p: String(path).slice(0, 200), s: status, ms, ...(key ? { k: String(key) } : {}) }) + "\n");
    } catch { /* logging must never break a request */ }
  };
}
