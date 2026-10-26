import fs from 'node:fs';
const p = 'data/devices.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.devices = j.devices.filter(d => d.id !== 'device-001');
const lines = fs.readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
for (const l of lines) {
  const [name, category = 'other', protocol = '', address = ''] = l.split(',').map(s => s.trim());
  const id = 'device-' + String(j.devices.length + 1).padStart(3, '0');
  j.devices.push({ id, name, category, protocol, address, api_id: '', enabled: true });
}
fs.writeFileSync(p, JSON.stringify(j, null, 1));
console.log('DEVICES_TOTAL', j.devices.length);
