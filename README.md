# KI

Central registry of APIs, devices and AI apps. Other pages read these JSON files; nothing here is executable.

## Use from other pages
Start at `data/index.json` (lists every file), for example:
`https://raw.githubusercontent.com/KHOEM-AI/KI/main/data/index.json`

## Files in `data/`
- `apis.json` services (base_url, auth type, name of the env key, last verified date)
- `endpoints.json` route groups per service
- `devices.json` pointer only: device records live in the KSV database (GET /api/devices, login required), never in GitHub
- `ai-apps.json` AI apps and the API each one uses
- `categories.json`, `protocols.json`, `locations.json`, `statuses.json` shared vocabularies
- `languages.json`, `i18n-km.json`, `i18n-en.json` KI texts (keys start with `ki.`; the language registry itself belongs to KHOEM_AI)

## Rules
- No secrets and no LAN IP addresses in this repo. Keys live in `.env`; device IPs live in `local/` (ignored by git). `.env.example` lists only the key names.
- Addresses like 127.0.0.1 only work on the phone that runs the services.
- Only entries with a `verified` date were checked against a running service; the rest come from READMEs and are not verified.

## Check before every push
`npm run validate` (or `node scripts/validate.mjs`)
Add devices from the terminal: `node scripts/add-devices.mjs` (one line each: name, category, protocol, address).
