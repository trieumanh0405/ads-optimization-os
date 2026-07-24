# API contracts

All stored-project and AI routes require a Firebase ID token with `organizationId` and `role` custom claims.

## Project configuration

- `POST /api/projects` — create/update config, metrics, mappings and versioned rules
- `GET /api/projects` — list projects in the caller organization
- `GET /api/projects/{projectId}` — retrieve the full project bundle

## Data

- `POST /api/normalize` — stateless mapping validation
- `POST /api/projects/{projectId}/import` — normalize and upsert rows using saved mapping

The project import route accepts either JSON or `Content-Type: text/csv`. For CSV, use `?mode=STRICT` or `?mode=PARTIAL`.

Import body:

```json
{ "mode": "STRICT", "rows": [{ "Date": "2026-07-20", "Spend": 100000 }] }
```

## Optimization

- `POST /api/optimize` — stateless engine execution for development/backtesting
- `POST /api/backtest` — execute the same request across explicit historical checkpoints
- `POST /api/projects/{projectId}/run` — load stored facts/config, run QC and engine, then persist run/actions

Run body:

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

- `GET|POST /api/ai/providers`
- `GET|POST /api/ai/playbooks`
- `POST /api/ai/analyze`

Provider API keys are accepted only by the authenticated server route, encrypted, and omitted from every response.

Supported provider kinds: `OPENAI_COMPATIBLE`, `ANTHROPIC`, and `GEMINI`. Every provider owns an allow-list of model IDs, so a project can select different models without changing analysis code.
