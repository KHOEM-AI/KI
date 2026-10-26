import fs from 'node:fs';
const p = 'data/apis.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const a = j.apis.find(x => x.id === 'khoem-ai-api');
a.verified_routes = ['/health','/api/languages','/api/locales','/api/coverage','/api/translate'];
a.note = 'GET routes verified 2026-10-26 (HTTP 200); POST /api/translate not tested';
fs.writeFileSync(p, JSON.stringify(j, null, 1));
