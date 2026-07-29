# Architecture

## Boundary map

1. **Project configuration** định nghĩa brand, KPI, target, lookback, context weights và guardrails.
2. **Ingestion** parse CSV và normalize source columns thành canonical facts.
3. **Metric engine** tổng hợp entity theo các evidence windows.
4. **Deterministic rule engine** tạo recommendation có thể truy vết.
5. **Action workflow** quản lý approval, terminal status và append-only audit.
6. **AI diagnostics** phân tích supporting metrics nhưng không override/execute rule.

`src/core` là formula source of truth. Spreadsheet cũ và transcript chỉ là reference behavior, không phải runtime dependency.

## Runtime flow

```text
CSV / connector
  -> column mapping
  -> /api/normalize
  -> canonical FactRow[]
  -> /api/optimize
  -> QC + evidence windows
  -> deterministic recommendations
  -> Action Queue
  -> approval + Action Log
                     \
                      -> optional AI diagnostics (advisory only)
```

## Persistence modes

### Browser workspace

- IndexedDB database: `ads-optimization-os`
- One workspace contains multiple projects/brands.
- Auto-save is debounced after state changes.
- Export/Restore uses a versioned JSON envelope.
- Suitable for immediate use, solo media buyer workflow and functional validation.
- Data is scoped to that browser profile/device; it is not team synchronization.

### Supabase team backend

Stored APIs are designed for shared operation:

- `organizations/{organizationId}`
- `projects/{projectId}`
- `projects/{projectId}/metricMappings/{mappingId}`
- `projects/{projectId}/rules/{ruleId}`
- `projects/{projectId}/dailyEntityMetrics/{metricId}`
- `projects/{projectId}/actionQueue/{actionId}`
- `projects/{projectId}/actionLog/{eventId}`
- `organizations/{organizationId}/aiProviders/{providerId}`
- `organizations/{organizationId}/analysisPlaybooks/{playbookId}`

Supabase Auth sessions authenticate users. PostgreSQL stores a simple admin/user model: admins manage the team and all projects, while users operate their own or assigned projects. Server APIs enforce these rules even though their service-role client bypasses RLS. Raw data should stay outside hot dashboard reads; production connectors upsert canonical daily facts.

## Data contract

Canonical identity and metric fields live in `FactRow`. Brand-specific fields are stored in:

- `metrics: Record<string, number | null>`
- `dimensions: Record<string, string | null>`

Custom metric operands reference flexible metrics as `metrics.<key>`.

## Trust boundaries

- Browser BYOK requests send a key only to the same-origin serverless route for that request.
- The direct AI route accepts public HTTPS provider endpoints only and blocks common private/local address ranges.
- Provider calls time out before the Vercel function limit.
- Stored Supabase provider keys are encrypted and never returned.
- AI outputs are Zod-validated and cannot mutate deterministic actions.
- V1 does not call Meta Marketing API.

## Deployment

- Next.js application and serverless APIs run on Vercel.
- Browser workspace requires no external database.
- Supabase activates when the three Supabase environment variables are configured.
- GitHub Actions runs typecheck, tests and production build.
