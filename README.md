# Ads Optimization OS

Internal decision-support system for media buyers. The repository now contains the production core engine, authenticated Firebase persistence APIs, action workflow, and optional AI diagnostics. The interface remains a thin consumer of these contracts.

> The deterministic rule engine owns recommendations. AI is advisory and cannot execute or override actions.

## Product scope

- Multi-brand project workspaces
- Configurable KPI and metric mapping
- Today / 3D / 7D evidence windows
- Campaign, ad set and ad rule sets
- CBO/ABO-aware budget ownership
- Action review and append-only audit history
- Multi-provider AI analysis with versioned playbooks
- Strict/partial brand-specific raw-data mapping
- Data-quality blocking before destructive recommendations
- Stateless optimization and persisted project-run APIs

## Stack

- Next.js + TypeScript on Vercel
- Firebase Authentication + Firestore
- n8n or existing connectors for scheduled Meta Ads ingestion
- OpenAI-compatible provider adapter for OpenAI, OpenRouter, gateways and compatible endpoints

## Local development

1. Copy `.env.example` to `.env.local`.
2. Create a Firebase web app and service account.
3. Fill the environment values.
4. Run `pnpm install`, then `pnpm dev`.

## Project layout

```text
src/
  ai/          provider adapters, contracts and versioned playbooks
  app/         Next.js screens and API routes
  components/  shared interface components
  core/        canonical data, metrics, windows, rules, QC and actions
  server/      Firebase repositories, authorization and secret encryption
docs/
  API.md
  ARCHITECTURE.md
  CORE_ENGINE.md
  CONTRIBUTING.md
```

## Adding an ads analysis skill

Do not paste a skill directly into a UI component or route. Convert it into a versioned playbook with:

- purpose and supported project type
- required and optional metrics
- explicit formulas/definitions
- observation vs hypothesis rules
- missing-data behavior
- output schema and prohibited actions
- test fixtures with expected reasoning

Place the normalized playbook in `src/ai/playbooks`, add its tests, and store the enabled version per project.

## Formula source of truth

Read [Core engine specification](docs/CORE_ENGINE.md). Business formulas must be implemented and tested in `src/core`; React components must not contain alternate rule logic.

## API

Read [API contracts](docs/API.md). Stored routes require Firebase custom claims:

- `organizationId`
- `role`: `admin`, `leader`, `buyer` or `reviewer`

Start integration with [`examples/engine-request.json`](examples/engine-request.json) and [`examples/source-mapping.json`](examples/source-mapping.json). They contain contracts and no fabricated output rows.

## Deployment

Import the GitHub repository into Vercel, configure environment variables, and deploy. Add the same production domain to Firebase Authentication authorized domains.

See [architecture](docs/ARCHITECTURE.md) and [contributing](docs/CONTRIBUTING.md).
