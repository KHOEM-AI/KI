import fs from 'node:fs';
let bad = 0;
const err = m => { console.log('ERROR', m); bad++; };
const files = fs.readdirSync('data').filter(f => f.endsWith('.json')).sort();
const data = {};
for (const f of files) {
  const t = fs.readFileSync('data/' + f, 'utf8');
  try { data[f] = JSON.parse(t); } catch { err('invalid JSON: ' + f); }
  if (/(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,})/.test(t)) err('possible secret: ' + f);
  if (/\b192\.168\.\d{1,3}\.\d{1,3}\b/.test(t)) err('private LAN IP (keep in local/): ' + f);
}
const ids = (arr, label) => {
  const s = new Set();
  for (const x of arr) { if (!x.id) err(label + ': missing id'); else if (s.has(x.id)) err(label + ': duplicate id ' + x.id); s.add(x.id); }
  return s;
};
const apiIds = ids(data['apis.json']?.apis ?? [], 'apis');
ids(data['devices.json']?.devices ?? [], 'devices');
ids(data['ai-apps.json']?.apps ?? [], 'ai-apps');
const cats = new Set((data['categories.json']?.categories ?? []).map(c => c.id));
const protos = new Set(data['protocols.json']?.protocols ?? []);
for (const a of data['ai-apps.json']?.apps ?? []) if (!apiIds.has(a.api_id)) err('ai-apps ' + a.id + ': unknown api_id ' + a.api_id);
for (const d of data['devices.json']?.devices ?? []) {
  if (d.api_id && !apiIds.has(d.api_id)) err('device ' + d.id + ': unknown api_id');
  if (!cats.has(d.category)) err('device ' + d.id + ': unknown category ' + d.category);
  if (d.protocol && !protos.has(d.protocol)) err('device ' + d.id + ': unknown protocol ' + d.protocol);
}
const dt = data['device-types.json'];
if (dt) {
  const doms = new Set(dt.domains.map(x => x.id));
  const tids = ids(dt.types, 'device-types');
  for (const x of dt.types) {
    if (!cats.has(x.category)) err('type ' + x.id + ': unknown category ' + x.category);
    if (!doms.has(x.domain)) err('type ' + x.id + ': unknown domain ' + x.domain);
    if (!['low', 'medium', 'high'].includes(x.risk)) err('type ' + x.id + ': bad risk');
  }
  for (const d of data['devices.json']?.devices ?? []) if (d.type && !tids.has(d.type)) err('device ' + d.id + ': unknown type ' + d.type);
}
const idx = data['index.json']?.files ?? [];
for (const f of files) if (f !== 'index.json' && !idx.includes(f)) err('not listed in index.json: ' + f);
for (const f of idx) if (!files.includes(f)) err('index.json lists missing file: ' + f);
const km = Object.keys(data['i18n-km.json'] ?? {}), en = Object.keys(data['i18n-en.json'] ?? {});
for (const k of en) if (!km.includes(k)) err('i18n-km missing ' + k);
for (const k of km) if (!en.includes(k)) err('i18n-en missing ' + k);
for (const k of new Set([...km, ...en])) if (!k.startsWith('ki.')) err('i18n key without ki. prefix: ' + k);
console.log(bad ? 'FAIL (' + bad + ')' : 'VALID_OK');
process.exit(bad ? 1 : 0);
