# Ads Optimization OS

An internal decision-support tool for trained media buyers. It normalizes advertising data, evaluates project-specific deterministic rules, and produces an auditable Action Queue. It does not execute Meta Ads changes in V1.

## What works

- Multi-brand project configuration, KPI dictionary, custom metrics and mapping.
- CSV and Google Sheets validation/normalization with Strict and Partial modes.
- Deterministic Campaign, Ad set and Ad rule engine with lookback windows, conflict detection, CBO/ABO ownership and scale guardrails.
- Action Queue with PENDING, DONE, REJECTED and DEFERRED lifecycle plus append-only audit log.
- Optional multi-provider AI diagnostics. AI is advisory and cannot override deterministic actions.
- Supabase team workspace: Supabase Auth, PostgreSQL, Row Level Security and project-level permissions.

## Data architecture

```text
Google Sheets / CSV / future BigQuery
  -> mapping + normalization
  -> canonical facts in Supabase
  -> deterministic rule engine
  -> action_queue + immutable action_log
```

Keep wide raw exports in Google Sheets/Drive initially. Only normalized facts and metrics needed by the engine belong in the operational database.

## Team authorization

- `admin`: creates users, assigns projects and sees every project.
- `user`: works on projects they created or were assigned; they cannot delete another user's project.
- An assignment grants the complete operating workflow (import, rules, run and Action Queue), keeping access easy to administer.
- The server validates access on every stored API route; hiding a UI button is never treated as authorization.

## Local development

Node.js 20+ and pnpm are required.

```bash
pnpm install
pnpm dev
```

Browser-only mode works without an `.env.local` file and saves to IndexedDB. It is suitable for private/offline work and has JSON Export/Restore.

## Supabase deployment

Follow [Supabase deployment setup](docs/SUPABASE_SETUP.md). In short:

1. Run `supabase/migrations/202607280001_initial_ads_optimization.sql` in the linked Supabase project.
2. Enable Supabase Email magic-link authentication and set Vercel redirect URLs.
3. Add the Supabase environment variables to Vercel.
4. Deploy and sign in; the first authenticated user creates the organization and becomes admin.

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, or provider API keys to the browser or commit them to Git.

### Google Sheets online sync

Create a read-only Google service account, enable Google Sheets API, share each raw-data sheet with that service account as **Viewer**, and set its complete JSON credential in the server-only `GOOGLE_SERVICE_ACCOUNT_JSON` Vercel variable. In Data import, select **Google Sheets**, paste the Sheet URL/ID, select the raw tab and scan headers. Column mapping remains project-specific and is saved with the project after the first successful import.

After the first validated import, the project can refresh the saved source manually from Decision board or automatically every 30 minutes to 6 hours while an authenticated team workspace is open. The recommended default is 60 minutes. Auto-run can create a fresh optimization snapshot immediately after a successful refresh. The engine uses the latest source date as its as-of date, reads stored facts in paginated batches, and derives Ad set/Campaign evidence from Ad-level exports when parent rows are not supplied separately.

## Validation

```bash
pnpm typecheck
pnpm test
pnpm build
```

If pnpm blocks build scripts on a new machine, run `pnpm approve-builds` and approve `esbuild` and `sharp` before building Next.js.

## Repository map

```text
src/
  ai/          provider adapters and versioned analysis playbooks
  app/         Next.js pages and API routes
  components/  operator UI
  core/        formulas, QC, rules and action lifecycle
  product/     browser workspace, Supabase browser client and UI utilities
  server/      Supabase authorization, persistence and encrypted secrets
supabase/
  migrations/  PostgreSQL schema and RLS policies
docs/
  PRD.md, ARCHITECTURE.md, API.md, SUPABASE_SETUP.md
```

## Useful endpoints

- `GET /api/health`
- `GET|POST /api/projects`
- `GET /api/projects/{projectId}/workspace`
- `POST /api/projects/{projectId}/import`
- `POST /api/projects/{projectId}/run`
- `PATCH /api/projects/{projectId}/actions/{actionId}`
