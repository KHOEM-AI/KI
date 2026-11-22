# KHOEM-AI · រចនាសម្ព័ន្ធ API (Architecture)

ឯកសារនេះផ្គូផ្គងរចនាសម្ព័ន្ធដែលបានស្នើ (Gateway កណ្ដាល + ក្រុម API ៨) ទៅនឹងអ្វីដែលមានពិតក្នុង KI។
ច្បាប់មូលដ្ឋាន៖ **មានតែសេវារបស់យើងផ្ទាល់ (127.0.0.1)** · ទិន្នន័យនៅលើទូរស័ព្ទ · គ្មាន secret ក្នុង GitHub · ការអនុញ្ញាតជា default-deny។

## ១. ស្ថានភាពក្រុម API នីមួយៗ

ស្លាក៖ ✅ មានហើយ · ⏳ មិនទាន់បង្កើត (មានមូលហេតុ និងលក្ខខណ្ឌខាងក្រោម)

| ក្រុមដែលស្នើ | ស្ថានភាព | នៅត្រង់ណា |
|---|---|---|
| AI & Chat | ✅ | `POST /v1/chat`, `GET /v1/models` → AI backend `:8787` |
| Knowledge / Search | ✅ | `POST /v1/search`, `/v1/retrieve` → CIDC `:8800` |
| ភាសា / បកប្រែ | ✅ | `POST /v1/translate`, `GET /v1/languages` → KHOEM_AI `:8790` |
| គណិតវិទ្យា | ✅ | `POST /v1/math` → EI-T `:3100` |
| សំឡេង វីដេអូ Media | ✅ | `/v1/audio/*`, `/v1/videos/*`, `/v1/media`, `/v1/projects` → IQ-AI `:8799` |
| Database | ✅ (ឯកសារ JSON) | `/v1/data/<collection>/<id>` (ក្នុង `~/.ki-data-*.json`) |
| Storage & Files | ✅ | `/v1/files` (ក្នុង `~/.ki-files/`) |
| Auth & Users | ✅ ផ្នែកដំបូង | Developer keys៖ `/v1/keys` (key មានវិសាលភាព, ដកបាន, មានកំណត់អត្រា)។ គណនីអ្នកប្រើដែលមាន password ⏳ |
| Developer Account | ✅ ផ្នែកដំបូង | key មួយក្នុងមួយកម្មវិធី (`name`, `scopes`, `last_used`, `count`) |
| API Usage Statistics | ✅ | `GET /v1/usage?days=7` (ពី access log, គ្មានទិន្នន័យថ្មីត្រូវប្រមូល) |
| Admin & System | ✅ អានភាគច្រើន | `GET /v1/system`, `/v1/keys`, `/v1/usage` (token មេតែប៉ុណ្ណោះ) |
| Security | ✅ | token មេ + key មាន scope + rate limit + access log + gateway default-deny |
| Developer Tools | ✅ | `GET /v1` (បញ្ជី route), `docs/API.md`, `npm run verify` |
| Payment | ⏳ | មើលផ្នែក ៤ |
| Plugin API | ⏳ | មើលផ្នែក ៤ |
| Integration API | ⏳ | មើលផ្នែក ៤ |

## ២. ស្រទាប់

```
 កម្មវិធី / AI UI / អ្នកអភិវឌ្ឍ
        │  x-ki-token (មេ)   ឬ   x-ki-key (developer key + scope)
        ▼
 ┌──────────────────────── KI API :5001 ────────────────────────┐
 │ /v1  ច្រកមានកំណែ      /gw  gateway (default-deny)   /api  KI │
 │  ├─ alias → /gw        ├─ ai, cidc, lang, ei-t, iqai          │
 │  ├─ files, data (ផ្ទាល់ខ្លួន)                                │
 │  └─ keys, usage, system (token មេតែប៉ុណ្ណោះ)                   │
 └──────────────────────────────────────────────────────────────┘
        ▼ (ក្នុង 127.0.0.1 តែប៉ុណ្ណោះ; key របស់ម៉ូឌុលនៅ .env មិនចេញមក)
 AI backend 8787 · CIDC 8800 · KHOEM_AI 8790 · EI-T 3100 · IQ-AI 8799
```

## ៣. Developer key

- បង្កើត៖ `POST /v1/keys` `{ "name": "app1", "scopes": ["chat","data"] }` → ទទួល `key` **តែម្ដង** (ទុកក្នុង hash SHA-256 តែប៉ុណ្ណោះ)។
- ប្រើ៖ header `x-ki-key: kik_...` លើ `/v1/...` តែប៉ុណ្ណោះ (ផ្សេងពីនេះ 403)។
- Scope៖ `chat` `search` `translate` `math` `media` `files` `data`។
- ដក៖ `DELETE /v1/keys/<id>`។ កំណត់អត្រាលំនាំដើម 120 សំណើ/នាទី/key (កែដោយ `KI_KEY_RATE_PER_MIN`)។
- ដែនកំណត់ដែលដឹងហើយ៖ key ដែលមាន scope `data` ឬ `files` ឃើញ collection និងឯកសារទាំងអស់ក្នុង KI (មិនទាន់បំបែកតាម key)។ កុំចែក key នេះឱ្យអ្នកដែលមិនទុកចិត្ត។

## ៤. អ្វីដែលមិនទាន់បង្កើត និងលក្ខខណ្ឌមុនបង្កើត

**Payment API**៖ ទាក់ទងលុយ និងច្បាប់។ មុនបង្កើតត្រូវសម្រេច៖ អ្នកផ្តល់សេវាទូទាត់ រូបិយប័ណ្ណ និងអ្នករក្សាទិន្នន័យកាត។ ការរចនា៖ មិនទុកលេខកាតក្នុង KI ទេ · webhook ត្រូវផ្ទៀងផ្ទាត់ signature · idempotency key · ចំនួនទឹកប្រាក់ជាចំនួនគត់ · audit log។ មិនអាចសាកល្បងអ្វីបានដោយគ្មានគណនីអ្នកផ្តល់សេវា។

**គណនីអ្នកប្រើ (login ពិត)**៖ ត្រូវមាន password hash (`crypto.scrypt` ក្នុង Node, គ្មាន dependency), session token ដែលទុកជា hash, ការចាក់សោពេលព្យាយាមខុសច្រើន, តួនាទី (role)។ គ្មាន "ភ្លេចលេខសម្ងាត់ តាមអ៊ីមែល" ព្រោះ KI មិនផ្ញើចេញក្រៅ ត្រូវសម្រេចវិធីផ្សេង។ ត្រូវរចនា និងតេស្តដាច់ដោយឡែក។

**Plugin API**៖ មិនផ្ទុកកូដរបស់អ្នកដទៃចូលក្នុង KI ទេ (ហានិភ័យខ្ពស់)។ កិច្ចសន្យាដែលស្នើ៖ plugin = សេវាដាច់ដោយឡែកលើ `127.0.0.1` + manifest (`id`, `name`, `version`, `base_url`, `health`, `auth`, `routes`) ដាក់ក្នុង `data/apis.json` + ការបន្ថែម alias ក្នុង `src/gateway.mjs` តាមរយៈការត្រួតពិនិត្យកូដ។ ដូចដែល `ai` ត្រូវបានបន្ថែម។

**Integration API (សេវាក្រៅ)**៖ ច្បាប់បច្ចុប្បន្នហាមសេវាក្រៅ។ បើចង់បើក ត្រូវសម្រេចជាមុន៖ បញ្ជីដែនអនុញ្ញាតច្បាស់លាស់, ចេញក្រៅតែប៉ុណ្ណោះ, secret ក្នុង `.env`។ មិនបើកដោយស្វ័យប្រវត្តិទេ។

**Database ធំជាងនេះ**៖ ឯកសារ JSON គ្រប់គ្រាន់សម្រាប់ការកំណត់ កំណត់ត្រា (≤1000 ឯកសារ/collection, ≤64 KB)។ បើលើសពីនេះ ត្រូវប្តូរម៉ាស៊ីនក្រោយ `/v1/data` ដដែល (ឧ. SQLite ក្នុង Node ថ្មី — ត្រូវសាកល្បងលើ Termux មុន)។ KSV API ត្រូវការ `DATABASE_URL` (MongoDB) ដាច់ដោយឡែក ហើយឥឡូវនៅទទេ។

## ៥. លំដាប់ការងារបន្ទាប់

1. ជួសជុល KSV API (`DATABASE_URL`) រួចបន្ថែម `ksv` អានតែប៉ុណ្ណោះ (health/version) ក្នុង gateway។
2. បំបែក `/v1/data` និង `/v1/files` តាម key (namespace ក្នុងមួយ key)។
3. គណនីអ្នកប្រើ + role (រចនា → តេស្ត → push)។
4. Plugin manifest + alias ដំបូង (ឧ. CAI ឬ MI-K-VISION-3D បើមាន API)។
5. Payment បន្ទាប់ពីសម្រេចអ្នកផ្តល់សេវា។

_ធ្វើបច្ចុប្បន្នភាព៖ 2026-11-23_
