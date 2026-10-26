import fs from 'node:fs';
const w = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));
const r = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const j = r('data/apis.json');
const up = o => { const i = j.apis.findIndex(a => a.id === o.id); if (i >= 0) Object.assign(j.apis[i], o); };
up({id:'khoem-ai-api',name:'KHOEM_AI (language and localization)',type:'localization',health:'/health',routes:['/api/languages','/api/locales','/api/translate','/api/coverage'],note:'routes from the spec, only /health verified'});
up({id:'iqai-media',note:'AI processing endpoints return 501; auth is one shared token; docs/API.md in the IQ-AI repo'});
w('data/apis.json', j);
w('data/languages.json', {version:1,source:'KHOEM_AI',default:'km',use:['km','en'],files:{km:'i18n-km.json',en:'i18n-en.json'},note:'Language registry lives in KHOEM_AI. KI only lists the codes it uses.'});
const ns = o => Object.fromEntries(Object.entries(o).map(([k, v]) => ['ki.' + k, v]));
for (const f of ['km', 'en']) { const p = `data/i18n-${f}.json`; const o = r(p); if (!Object.keys(o).some(k => k.startsWith('ki.'))) w(p, ns(o)); }
