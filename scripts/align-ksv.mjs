import fs from 'node:fs';
const w = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));
const r = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const c = r('data/categories.json');
for (const x of [
 {id:'industrial',km:'ឧស្សាហកម្ម',en:'Industrial'},
 {id:'vehicle',km:'យានយន្ត',en:'Vehicle'},
 {id:'network',km:'បណ្តាញ',en:'Network'}
]) if (!c.categories.some(y => y.id === x.id)) c.categories.splice(c.categories.length - 1, 0, x);
w('data/categories.json', c);
w('data/statuses.json', {version:1,statuses:[
 {id:'online',km:'កំពុងដំណើរការ',en:'Online'},
 {id:'warning',km:'ព្រមាន',en:'Warning'},
 {id:'offline',km:'គ្មានការតភ្ជាប់',en:'Offline'},
 {id:'maintenance',km:'កំពុងថែទាំ',en:'Maintenance'}]});
const ix = r('data/index.json');
if (!ix.files.includes('statuses.json')) ix.files.push('statuses.json');
w('data/index.json', ix);
