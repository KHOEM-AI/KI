import fs from 'node:fs';
const p = 'data/apis.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const d = new Date().toISOString().slice(0, 10);
const k = j.apis.find(a => a.id === 'ksv-api'); if (k) k.health = '/health';
for (const a of j.apis) {
  if (!a.base_url?.startsWith('http')) continue;
  let s = 0;
  try { s = (await fetch(a.base_url + (a.health || ''), { signal: AbortSignal.timeout(3000) })).status; } catch {}
  a.status_seen = s; a.checked = d;
  if (s) a.verified = d; else delete a.verified;
  console.log(a.id.padEnd(14), s || 'DOWN');
}
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
