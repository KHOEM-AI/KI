import fs from 'node:fs';
const p = 'data/apis.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const up = o => { const i = j.apis.findIndex(a => a.id === o.id); if (i >= 0) Object.assign(j.apis[i], o); else j.apis.push(o); };
up({id:'ai-backend',name:'KHOEM AI backend',type:'ai',base_url:'http://127.0.0.1:8787',health:'/api/health',auth:'header',auth_header:'x-api-key',env_key:'KHOEM_API_KEY',routes_url:'/api/routes/all',repo:'KHOEM-AI/AI',enabled:true});
up({id:'ai-ui',name:'KHOEM AI UI',type:'ui',base_url:'http://127.0.0.1:5175',repo:'KHOEM-AI/AI',enabled:true});
up({id:'ksv-api',name:'KSV platform API',type:'platform',base_url:'http://127.0.0.1:3000/api/v1',auth:'bearer',repo:'KHOEM-AI/KSV',note:'port 3000 from Postman guide, not verified',enabled:true});
fs.writeFileSync(p, JSON.stringify(j, null, 1));
const ep = {version:1,services:{
'ai-backend':{public:['/api/health','/api','/api/models','/api/status','/api/control','/api/chat','/api/registry','/api/routes/all'],
protected:['/api/scan','/api/check','/api/find','/api/funcs','/api/read','/api/learn','/api/learned','/api/forget','/api/audit','/api/tasks','/api/metrics','/api/budget','/api/circuit','/api/approvals','/api/code','/api/patch','/api/sandbox','/api/verify','/api/rollback','/api/system','/api/goals','/api/plans','/api/ideas','/api/experiments','/api/khoem','/api/lexicon','/api/library','/api/model','/api/tools','/api/agent','/api/characters','/api/assets','/api/storyboards','/api/shotlist']},
'ksv-api':{groups:['auth','users','orgs','devices','discovery','commands','gateways','protocols','safety','events','sessions'].map(g=>'/api/v1/'+g)}}};
fs.writeFileSync('data/endpoints.json', JSON.stringify(ep, null, 1));
const ix = JSON.parse(fs.readFileSync('data/index.json', 'utf8'));
if (!ix.files.includes('endpoints.json')) ix.files.push('endpoints.json');
fs.writeFileSync('data/index.json', JSON.stringify(ix));
