# KI API

How other apps and pages read data from the KHOEM-AI system. KI is the central API (registry, `/gw` gateway, `/v1`); KSV is the live device API. See `docs/ARCHITECTURE.md`.

## 1. KI registry (read-only JSON)

The GitHub copy needs no login (on the phone, KI needs the token, see below). Start from the index, it lists every file:

```
curl https://raw.githubusercontent.com/KHOEM-AI/KI/main/data/index.json
```

On the phone that runs the services, KI (port 5001) serves the same files read-only. When `KI_API_TOKEN` is set in `~/KI/.env`, every route except `GET /api/healthz` needs the header `x-ki-token` (without it: 401), for example `curl -H "x-ki-token: $KI_API_TOKEN" http://127.0.0.1:5001/api/registry`. Only files listed in the index are served, and `local/` never is:

```
curl http://127.0.0.1:5001/api/registry          # the index
curl http://127.0.0.1:5001/api/registry/apis     # a file from the index, without .json
```

| File | Content |
|---|---|
| `apis.json` | services: base_url, auth type, env key name, last verified date |
| `endpoints.json` | route groups per service |
| `devices.json` | pointer only: real device records live in KSV (GET /api/devices, login required) |
| `ai-apps.json` | AI apps and the API each one uses |
| `device-types.json` | catalog of device kinds with risk level |
| `ksv-device-fields.json` | KSV device model fields |
| `categories.json / protocols.json / locations.json / statuses.json` | shared vocabularies |
| `languages.json, i18n-km.json, i18n-en.json` | KI texts (keys start with ki.) |

Only entries with a `verified` date were checked against a running service.

## 2. KSV live API

Base URL: `http://127.0.0.1:3000` (works only on the phone running the server). Replace with your own deployed address; never commit LAN IPs.

Login, then send the token on every protected call:

```
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login/password \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOU@EXAMPLE.COM","password":"YOUR_PASSWORD"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')

curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/devices
```

- Access tokens are short-lived; renew with `POST /api/auth/token/refresh`.
- Data is scoped to the caller's organization. Each route needs a permission (for example `device:read`, `org:read`, `org:manage`).
- `GET /api/health` and `GET /api/version` need no login.

### Routes (128, generated from src/server.ts, not individually verified)

Routes whose path is built in code are not listed. The list is generated, so it may contain artifacts (a `${verb}` placeholder, a trailing-slash path, a duplicated `GET /api/gateways`): treat it as a guide, not a contract.

#### /api/certificates

| Method | Path |
|---|---|
| GET | `/api/certificates` |
| POST | `/api/certificates` |

#### /api/vocabulary

| Method | Path |
|---|---|
| GET | `/api/vocabulary` |
| GET | `/api/vocabulary/:language` |

#### /api/health

| Method | Path |
|---|---|
| GET | `/api/health` |

#### /api/version

| Method | Path |
|---|---|
| GET | `/api/version` |

#### /api/users

| Method | Path |
|---|---|
| POST | `/api/users` |

#### /api/devices

| Method | Path |
|---|---|
| POST | `/api/devices/:id/commands` |
| GET | `/api/devices` |
| GET | `/api/devices/:id/state` |
| GET | `/api/devices/:id` |
| POST | `/api/devices` |
| PUT | `/api/devices/:id` |
| DELETE | `/api/devices/:id` |

#### /api/auth

| Method | Path |
|---|---|
| POST | `/api/auth/token/refresh` |
| POST | `/api/auth/location` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/sessions` |
| DELETE | `/api/auth/sessions/:sessionId` |
| POST | `/api/auth/password/change` |
| POST | `/api/auth/register` |
| POST | `/api/auth/login/password` |
| POST | `/api/auth/mfa/enroll` |
| POST | `/api/auth/mfa/enroll/confirm` |
| POST | `/api/auth/mfa/disable` |
| POST | `/api/auth/mfa/verify` |

#### /api/settings

| Method | Path |
|---|---|
| GET | `/api/settings` |
| PUT | `/api/settings` |

#### /api/commands

| Method | Path |
|---|---|
| GET | `/api/commands/recent` |
| GET | `/api/commands/:id` |

#### /api/security

| Method | Path |
|---|---|
| POST | `/api/security/threats` |
| GET | `/api/security/threats` |
| GET | `/api/security/sessions` |
| GET | `/api/security/incidents` |

#### /api/organizations

| Method | Path |
|---|---|
| GET | `/api/organizations` |
| GET | `/api/organizations/:orgId` |
| POST | `/api/organizations` |
| PUT | `/api/organizations/:orgId` |
| DELETE | `/api/organizations/:orgId` |
| GET | `/api/organizations/:orgId/sites` |
| GET | `/api/organizations/:orgId/sites/:siteId` |
| POST | `/api/organizations/:orgId/sites` |
| PUT | `/api/organizations/:orgId/sites/:siteId` |
| DELETE | `/api/organizations/:orgId/sites/:siteId` |
| GET | `/api/organizations/:orgId/members` |
| GET | `/api/organizations/:orgId/members/:memberId` |
| PUT | `/api/organizations/:orgId/members/:memberId/role` |
| DELETE | `/api/organizations/:orgId/members/:memberId` |
| GET | `/api/organizations/:orgId/sites/:siteId/buildings` |
| POST | `/api/organizations/:orgId/sites/:siteId/buildings` |
| PUT | `/api/organizations/:orgId/sites/:siteId/buildings/:buildingId` |
| DELETE | `/api/organizations/:orgId/sites/:siteId/buildings/:buildingId` |
| GET | `/api/organizations/:orgId/sites/:siteId/buildings/:buildingId/rooms` |
| POST | `/api/organizations/:orgId/sites/:siteId/buildings/:buildingId/rooms` |
| PUT | `/api/organizations/:orgId/sites/:siteId/buildings/:buildingId/rooms/:roomId` |
| DELETE | `/api/organizations/:orgId/sites/:siteId/buildings/:buildingId/rooms/:roomId` |

#### /api/safety

| Method | Path |
|---|---|
| GET | `/api/safety/rules` |
| POST | `/api/safety/rules` |
| GET | `/api/safety/rules/:ruleId` |
| PUT | `/api/safety/rules/:ruleId` |
| DELETE | `/api/safety/rules/:ruleId` |
| POST | `/api/safety/rules/:ruleId/` |
| GET | `/api/safety/events/:eventId` |
| GET | `/api/safety/emergency-stop` |
| POST | `/api/safety/emergency-stop` |
| POST | `/api/safety/emergency-stop/release` |
| POST | `/api/safety/check` |
| GET | `/api/safety/devices` |
| GET | `/api/safety/events` |

#### /api/gateways

| Method | Path |
|---|---|
| GET | `/api/gateways` |
| POST | `/api/gateways` |
| GET | `/api/gateways` |
| GET | `/api/gateways/:gatewayId` |

#### /api/audit

| Method | Path |
|---|---|
| GET | `/api/audit/events` |
| GET | `/api/audit/logs` |

#### /api/protocols

| Method | Path |
|---|---|
| GET | `/api/protocols` |
| GET | `/api/protocols/adapters` |

#### /api/identity

| Method | Path |
|---|---|
| GET | `/api/identity/account` |

#### /api/notifications

| Method | Path |
|---|---|
| GET | `/api/notifications` |

#### /api/map

| Method | Path |
|---|---|
| GET | `/api/map/devices` |

#### /api/international

| Method | Path |
|---|---|
| GET | `/api/international/countries` |
| GET | `/api/international/languages` |

#### /api/automation

| Method | Path |
|---|---|
| GET | `/api/automation/rules` |
| POST | `/api/automation/rules` |
| GET | `/api/automation/rules/:id` |
| PATCH | `/api/automation/rules/:id` |
| DELETE | `/api/automation/rules/:id` |
| POST | `/api/automation/rules/:id/${verb}` |
| POST | `/api/automation/scenes` |
| GET | `/api/automation/scenes` |
| GET | `/api/automation/scenes/:id` |
| PUT | `/api/automation/scenes/:id` |
| DELETE | `/api/automation/scenes/:id` |
| POST | `/api/automation/scenes/:id/activate` |

#### /api/discovery

| Method | Path |
|---|---|
| GET | `/api/discovery/devices` |

#### /api/pairing

| Method | Path |
|---|---|
| POST | `/api/pairing/sessions` |
| GET | `/api/pairing/sessions/:id` |
| POST | `/api/pairing/sessions/:id/verify-owner` |
| POST | `/api/pairing/sessions/:id/confirm` |
| DELETE | `/api/pairing/sessions/:id` |
| GET | `/api/pairing/devices` |
| POST | `/api/pairing/devices/:deviceId/unpair` |

#### /api/recovery

| Method | Path |
|---|---|
| POST | `/api/recovery/initiate` |
| POST | `/api/recovery/otp/verify` |
| POST | `/api/recovery/password/reset` |
| POST | `/api/recovery/cancel` |

#### /api/telemetry

| Method | Path |
|---|---|
| GET | `/api/telemetry/devices/:id` |

#### /api/billing

| Method | Path |
|---|---|
| GET | `/api/billing/invoices` |
| GET | `/api/billing/invoices/:id/download` |
| POST | `/api/billing/payment-methods` |
| DELETE | `/api/billing/payment-methods/:id` |
| GET | `/api/billing/usage` |
| GET | `/api/billing/subscriptions` |
| PUT | `/api/billing/subscriptions/:id` |
| DELETE | `/api/billing/subscriptions/:id` |
| POST | `/api/billing/subscriptions` |
| GET | `/api/billing/plans` |

#### /api/ai

| Method | Path |
|---|---|
| POST | `/api/ai/interpret` |
| GET | `/api/ai/sessions/:id` |
| DELETE | `/api/ai/sessions/:id` |
| POST | `/api/ai/interpret/confirm` |
| GET | `/api/ai/models` |
| POST | `/api/ai/models/:id/enable` |
| GET | `/api/ai/usage` |
| POST | `/api/ai/feedback` |

#### /api/dashboard

| Method | Path |
|---|---|
| GET | `/api/dashboard/stats` |
| GET | `/api/dashboard/full` |

#### /api/authz

| Method | Path |
|---|---|
| POST | `/api/authz/check` |

## 3. Rules
- No secrets and no LAN IPs in this repo. Key names are in `.env.example`.
- Run `npm run validate` before every push.


## 4. Clients

- MI-K-VISION-3D (:5176) reaches KI through a Vite proxy, `/ki/api/*` to `http://127.0.0.1:5001/api/*`. The proxy allows only: GET healthz, registry, registry/device-types, scans, colors, and POST scans, colors. Everything else returns 403 (see `vite.config.mjs` there).
- Every KI route except `GET /api/healthz` needs the `x-ki-token` header. KI answers every origin (`Access-Control-Allow-Origin: *`) and listens on 127.0.0.1 only. Do not expose it on the LAN.

## KI gateway (own services only)

KI forwards to the other KHOEM-AI services at `/gw/<service>/<route>`. Callers send only `x-ki-token`; each service's own credential (`env_key` in `data/apis.json`) is added by KI from `~/KI/.env` and is never returned. The gateway refuses to run without `KI_API_TOKEN`.

- Default deny: only routes listed in `src/gateway.mjs` are forwarded; anything else is 403.
- Upstreams must be on 127.0.0.1 or localhost (non-loopback is refused), so no external service can be reached.
- `GET /gw` lists every service, whether it is ready, and its allowed routes (never any secret).

| Service | Forwards to | Credential in ~/KI/.env |
|---|---|---|
| `cidc` | CIDC read-only data (`:8800/api/cidc`) | `CIDC_TOKEN` |
| `ei-t` | EI-T math (`:3100`) | none |
| `iqai` | IQ-AI audio, video, media, projects (`:8799/api/v1`) | `IQAI_TOKEN` |
| `ai` | AI backend: health, models, status, routes, chat (`:8787`) | `KHOEM_API_KEY` |
| `ksv` | KSV gateway (`:4000`), read-only: `GET /gw/ksv/api` (service list). Device control `/api/ksv/*` is not forwarded | `KHOEM_AI_API_KEY` |
| `lang` | KHOEM_AI language (`:8790`) | none |

```
curl -H "x-ki-token: $KI_API_TOKEN" http://127.0.0.1:5001/gw
curl -H "x-ki-token: $KI_API_TOKEN" http://127.0.0.1:5001/gw/cidc/statistics
```

## KI /v1 (versioned API)

One stable front door for apps and the AI UI. Every route needs `x-ki-token`; without `KI_API_TOKEN` it answers 503. Everything stays on the phone.

| Route | What it does |
|---|---|
| `GET /v1` | list of routes |
| `GET /v1/models`, `POST /v1/chat` | AI backend (`/gw/ai`) |
| `POST /v1/search`, `POST /v1/retrieve` | CIDC knowledge |
| `POST /v1/translate`, `GET /v1/languages` | KHOEM_AI language |
| `POST /v1/math`, `GET /v1/math/functions` | EI-T exact math |
| `/v1/audio/*`, `/v1/videos/*`, `/v1/media`, `/v1/projects` | IQ-AI |
| `GET,POST /v1/files` (`?name=`), `GET,DELETE /v1/files/<id>` | KI file store: raw body up to 20 MB, up to 500 files, saved in `~/.ki-files/` |
| `GET /v1/data`, `GET /v1/data/<collection>`, `GET,PUT,DELETE /v1/data/<collection>/<id>` | KI JSON store: a document is a JSON object up to 64 KB, up to 1000 per collection, saved in `~/.ki-data-<collection>.json` |

- Module routes are forwarded by the gateway, so its allowlist (default deny), loopback rule and server-side credentials apply. A method the gateway does not allow answers 403.
- Names: collection `a-z 0-9 -` (max 32), document id `A-Za-z0-9 _ . -` (max 64, starts with a letter or digit). Downloads are always `attachment` with `nosniff`.
- Not included on purpose: user accounts, payments or a generic database. Developer keys, usage and system (below) are admin routes for the master token. They need their own design and review.

```
curl -H "x-ki-token: $T" -H "Content-Type: application/json" -d '{"title":"hi"}' -X PUT http://127.0.0.1:5001/v1/data/notes/n1
curl -H "x-ki-token: $T" --data-binary @photo.jpg "http://127.0.0.1:5001/v1/files?name=photo.jpg"
```

### Developer keys, usage and system (master token only, except where noted)

| Route | What it does |
|---|---|
| `GET /v1/keys` | list keys (id, name, prefix, scopes, created, last_used, count, revoked) and the valid scopes; never the key or its hash |
| `POST /v1/keys` | `{ "name": "app1", "scopes": ["chat","data"] }`; the response holds the new `key` once |
| `DELETE /v1/keys/<id>` | revoke |
| `GET /v1/usage?days=7` | totals from the access log: status classes, top routes, per key, per day (1-30 days) |
| `GET /v1/system[?services=1]` | version, uptime, storage counts, key counts; `services=1` also probes every service |

A developer key goes in header `x-ki-key`. It works only on `/v1/<scope>` routes of its scopes (`chat` `search` `translate` `math` `media` `files` `data`), never on `/api`, `/gw`, `/v1/keys`, `/v1/usage` or `/v1/system` (403). Wrong, missing or revoked key: 401. More than `KI_KEY_RATE_PER_MIN` (default 120) requests in a minute: 429. Only a SHA-256 hash is stored, in `~/.ki-keys.json` (mode 600). Keys with `data` or `files` see every collection and file. See `docs/ARCHITECTURE.md` for the plan and what is not built yet.

## KI notifications and status

Both need `x-ki-token` (when `KI_API_TOKEN` is set). Nothing leaves the phone: events are stored in `~/.ki-notifications.json` (newest 500; when full, read items are dropped first so unread alerts are kept).

| Method | Route | What it does |
|---|---|---|
| POST | `/api/notify` | `{ "source": "ei-t", "level": "info\|warn\|error\|critical", "title": "...", "message": "..." }` (title up to 120, message up to 1000) |
| GET | `/api/notifications` | newest first; filters `?unread=1&level=warn&source=ei-t&limit=50`; also returns `unread` and `total` |
| POST | `/api/notifications/read` | `{ "ids": ["..."] }` or `{ "all": true }` |
| GET | `/api/status` | asks each service in the registry if it answers: `ok`, `up` (answers 4xx), `error` (5xx), `down`, `disabled`, `skipped` (not http or not loopback) |

From a shell script: `node ~/KI/scripts/notify.mjs warn ksv "KSV API not ready" "see ~/ksv-api.log"`
