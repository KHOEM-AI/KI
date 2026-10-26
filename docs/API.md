# KI API

How other apps and pages read data from the KHOEM-AI system. Two layers: static JSON registry (KI) and the live API (KSV).

## 1. KI registry (read-only JSON)

No login. Start from the index, it lists every file:

```
curl https://raw.githubusercontent.com/KHOEM-AI/KI/main/data/index.json
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

Routes whose path is built in code are not listed.

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

