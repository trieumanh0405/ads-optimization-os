# API contracts

Stored-project routes and stored AI configuration routes require a Firebase ID token with `organizationId` and `role` custom claims. Stateless routes and browser BYOK analysis do not require Firebase.

## Health

- `GET /api/health` — runtime status, capabilities and whether Firebase team backend credentials are configured

## Project configuration

- `POST /api/projects` — create/update config, metrics, mappings and versioned rules
- `GET /api/projects` — list projects in the caller organization
- `GET /api/projects/{projectId}` — retrieve the full project bundle

## Data

- `POST /api/normalize` — stateless canonical/supporting-metric/dimension mapping validation
- `POST /api/projects/{projectId}/import` — normalize and upsert rows using saved mapping

The stored import route accepts JSON or `Content-Type: text/csv`. For CSV, use `?mode=STRICT` or `?mode=PARTIAL`.

```json
{ "mode": "STRICT", "rows": [{ "Date": "2026-07-20", "Spend": 100000 }] }
```

## Optimization

- `POST /api/optimize` — stateless engine execution used by Browser workspace and tests
- `POST /api/backtest` — run the same engine across historical checkpoints
- `POST /api/projects/{projectId}/run` — load stored facts/config, run QC/engine and persist run/actions

```json
{ "asOfDate": "2026-07-20", "runAt": "2026-07-20T08:00:00+07:00" }
```

## Action review

- `GET /api/projects/{projectId}/actions?status=PENDING`
- `PATCH /api/projects/{projectId}/actions/{actionId}`
- `GET /api/projects/{projectId}/runs`

```json
{ "to": "DONE", "at": "2026-07-20T09:00:00+07:00", "note": "Executed in Ads Manager" }
```

## AI

- `GET|POST /api/ai/providers` — stored encrypted provider configuration
- `GET|POST /api/ai/playbooks` — stored playbook configuration
- `POST /api/ai/analyze` — authenticated analysis using a stored provider
- `POST /api/ai/direct` — Browser BYOK analysis using selected built-in playbooks

Stored provider keys are accepted only by authenticated routes, encrypted and omitted from responses. The direct route accepts a key for one request, permits only public HTTPS base URLs and does not persist the key.

Supported provider kinds:

- `OPENAI_COMPATIBLE`
- `ANTHROPIC`
- `GEMINI`
