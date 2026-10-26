import fs from 'node:fs';
let bad = 0;
for (const f of fs.readdirSync('data')) {
  const t = fs.readFileSync('data/' + f, 'utf8');
  try { JSON.parse(t); } catch (e) { console.log('JSON_ERROR', f); bad++; }
  if (/(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,})/.test(t)) { console.log('SECRET_FOUND', f); bad++; }
}
console.log(bad ? 'FAIL' : 'VALID_OK');
process.exit(bad ? 1 : 0);
