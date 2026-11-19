import fs from 'node:fs';
const reg = JSON.parse(fs.readFileSync('data/apis.json', 'utf8')).apis;
const known = {5001:'KI',5173:'KSV UI',5175:'AI UI',5176:'MI-K 3D',5180:'CAI scan',5181:'CAI share',5190:'CIDC UI',8787:'AI backend',8790:'KHOEM_AI',8799:'IQ-AI',8800:'CIDC API',4000:'KSV gateway',3000:'KSV API',3100:'EI-T',9300:'phone torch',9301:'phone bridge'};
const ports = new Set(reg.map(a => { try { return Number(new URL(a.base_url).port); } catch { return 0; } }));
for (const [p, n] of Object.entries(known)) {
  let st = 'down';
  try { st = (await fetch(`http://127.0.0.1:${p}/`, { signal: AbortSignal.timeout(2000) })).status; } catch {}
  console.log(p, n.padEnd(14), String(st).padEnd(5), ports.has(Number(p)) ? 'in-registry' : 'NOT-in-registry');
}
