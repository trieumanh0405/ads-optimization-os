# Supabase team deployment

This project uses Supabase for team authentication and operational data. Google Sheets is the current source of raw data; Supabase stores normalized facts, configuration, runs, action queue and append-only audit history.

## 1. Apply the database migration

In the connected Supabase project, open **SQL Editor** and run the complete contents of:

`supabase/migrations/202607280001_initial_ads_optimization.sql`

The migration creates the tables, indexes and Row Level Security policies. Do not create tables manually and do not disable RLS.

## 2. Configure Auth

In **Authentication > Providers**, enable Email (magic link). Add the production Vercel URL and local URL to **Authentication > URL Configuration > Redirect URLs**:

```text
https://ads-optimization-app.vercel.app
http://localhost:3000
```

Google OAuth may be enabled later; it does not change backend authorization.

## 3. Configure Vercel variables

In Vercel, add these values for Production, Preview and Development as appropriate:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase publishable/anon key>
SUPABASE_SERVICE_ROLE_KEY=<Supabase service_role key>
PROVIDER_KEY_ENCRYPTION_SECRET=<a random secret of at least 32 characters>
CRON_SECRET=<a separate random secret>
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. It must never have the `NEXT_PUBLIC_` prefix and must never be pasted into a browser, Google Sheet or GitHub issue.

## 4. Create the first admin

Deploy, open the app and request an email magic link. On first sign-in the app asks for the organization name; that user becomes the first `admin` in `organization_members`.

For every later team member:

1. They sign in once with Supabase Auth.
2. An admin grants organization and project membership through the Supabase SQL Editor or the forthcoming team-admin screen.
3. Give only the necessary project capabilities: `can_import`, `can_run`, `can_edit_config`, `can_edit_rules`, `can_review_actions`.

Admin and leader roles see every project in their organization. Buyer and reviewer roles see only explicitly assigned projects.

## Operational data flow

```text
Google Sheets / CSV / future BigQuery
  -> mapping profile and normalization
  -> Supabase facts (incremental upsert)
  -> deterministic rule engine
  -> action_queue + immutable action_log
```

Do not copy the full 75+ column raw exports into the hot fact table. Keep raw source in Sheets/Drive initially; upsert only canonical facts and supporting metrics needed by the engine. Use `project_id + source_row_key` as the idempotency key.

## Verification

After deployment, call `GET /api/health`. It must report:

```json
{ "supabaseTeamBackendConfigured": true }
```

Then sign in, create one project, import a small CSV, run the engine, and change one action status. Verify that `projects`, `facts`, `optimization_runs`, `action_queue`, `action_log`, and `import_runs` receive records in Supabase.
