# Ads Optimization OS

Internal decision-support app for media buyers. It standardizes project metrics, evaluates versioned optimization rules, produces an approval queue, and optionally adds AI diagnostics.

> The deterministic rule engine owns recommendations. AI is advisory and cannot execute or override actions.

## Product scope

- Multi-brand project workspaces
- Configurable KPI and metric mapping
- Today / 3D / 7D evidence windows
- Campaign, ad set and ad rule sets
- CBO/ABO-aware budget ownership
- Action review and append-only audit history
- Multi-provider AI analysis with versioned playbooks

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
  domain/      deterministic business logic
docs/
  ARCHITECTURE.md
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

## Deployment

Import the GitHub repository into Vercel, configure environment variables, and deploy. Add the same production domain to Firebase Authentication authorized domains.

See [architecture](docs/ARCHITECTURE.md) and [contributing](docs/CONTRIBUTING.md).
