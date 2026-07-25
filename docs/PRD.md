# Product Requirements Document — Ads Optimization OS

## 1. Product goal

Ads Optimization OS is an internal decision-support product for trained media buyers. It standardizes how teams review Campaign, Ad set and Ad performance across brands with different KPI definitions.

The final operational question is:

> Which entity should be turned off, kept, reviewed, decreased or invested in next — and which rule/evidence produced that recommendation?

The product reduces repetitive spreadsheet work. It does not claim to replace media-buyer judgment or perform autonomous Meta Ads changes in v1.

## 2. Personas

- **Leader/admin:** defines metric dictionary, default rules, guardrails and playbook versions.
- **Media buyer:** configures a project, imports data, runs the engine and executes approved actions.
- **Reviewer:** validates evidence, marks actions DONE/REJECTED/DEFERRED and records notes.
- **Developer/data owner:** maintains connectors, data contracts, provider adapters and team persistence.

## 3. Product principles

- Configuration over project-specific formulas.
- Missing data is `null`, never manufactured as zero.
- Deterministic rules create actions; AI is advisory.
- Every action is explainable and auditable.
- Ad → Ad set → Campaign execution order.
- CBO/ABO budget ownership is explicit.
- Project history survives refresh and rule version changes.

## 4. V1 functional requirements

### FR-01 — Multi-brand workspace

- Create, select and delete projects.
- Each project owns platform/account/timezone/currency/start date.
- Each project owns KPI, target, event meaning, sales model and tracking confidence.
- Workspace supports JSON export/restore.

### FR-02 — Metric dictionary

- Provide CPL, CPQL, CPA, ROAS, CTR, CPC, CVR and CPM.
- Allow custom SUM/RATIO/RATE definitions.
- Allow canonical operands and `metrics.<key>` operands.
- Configure direction as lower-is-better or higher-is-better.
- Changing Primary KPI updates the active rule metric key without editing formulas.

### FR-03 — Data import and mapping

- Accept comma, semicolon and tab-delimited CSV.
- Auto-detect common English/Vietnamese Meta export headers.
- Let users override canonical mappings.
- Let users add/remove supporting metric and context dimension mappings.
- Strict mode rejects a batch with any row error.
- Partial mode accepts only valid rows and reports rejected rows.
- Upsert by stable `sourceRowKey`.

### FR-04 — Data quality

- Block empty, stale, duplicate, wrong-project or invalid-weight runs.
- Ignore future rows with a warning.
- Show import and run QC in the UI.
- Never allow a stale/failed run to create destructive actions.

### FR-05 — Rule configuration

- Add, duplicate, edit, enable/disable, delete and reset rules.
- Support entity level, metric, score source, evidence source, evaluation field, spend/result minimums, operator, thresholds, action, adjustment and priority.
- Version rules by project rule set.

### FR-06 — Decision engine

- Calculate Today, Short, Long and Lifetime without overlapping Today into Short/Long.
- Calculate entity window score and parent/project context score.
- Support zero-result spend rules even when cost-per-result is null.
- Resolve top-priority conflicts to `REVIEW_MANUALLY`.
- Apply CBO/ABO and max-scale guardrails.
- Work when the import contains only the lowest available entity level.

### FR-07 — Decision board

- Filter by entity level/action and search entity.
- Show KPI today, target, achievement, action, adjustment, confidence and rule.
- Evidence drawer shows evaluated value, actual winning rule window, ownership/status and matched rule IDs.

### FR-08 — Action Queue

- Queue only executable/manual actions; KEEP and PENDING_DATA remain on Decision Board.
- Support PENDING, DONE, REJECTED and DEFERRED.
- Record operator, time, transition and note.
- Terminal actions cannot transition backward.
- Identical evidence cannot create a duplicate action, including after DONE/REJECTED.

### FR-09 — AI diagnostics

- Add/edit/delete multiple provider configurations.
- Support OpenAI-compatible, Anthropic and Gemini APIs.
- Keep browser BYOK keys out of workspace storage; optional session-only memory.
- Select multiple versioned playbooks.
- Return schema-validated observations, hypotheses, checks, commentary, confidence and limitations.
- Declare missing metrics instead of inventing them.
- Never override or execute deterministic actions.

### FR-10 — Audit and operability

- Show import history, engine runs and action log.
- Persist Browser workspace through reload.
- Expose `GET /api/health`.
- Maintain CI for typecheck, tests and build.

## 5. Out of scope for v1

- Automatic Meta Ads on/off or budget mutations.
- P&L, CRM, creative library or attribution replacement.
- Universal creative conclusions from CPA alone.
- Shared team synchronization without Firebase/Auth configuration.
- Treating Panasonic case numbers as universal benchmarks.

## 6. Non-functional requirements

- Deploy on Vercel free-compatible primitives.
- No database dependency for Browser workspace.
- Responsive desktop/tablet/mobile navigation.
- Keyboard-accessible native form controls.
- No API key in Git, local workspace export or API response.
- Core logic must be independently testable from React.

## 7. Acceptance criteria

- CSV totals normalize consistently with source rows.
- Metric missing values remain null.
- KPI target change changes recommendations without source edit.
- CPL and custom cost-per-booking run on the same engine.
- Today/3D/7D/Lifetime boundaries do not overlap incorrectly.
- Zero result + configured spend can trigger its explicit rule.
- Low evidence returns PENDING_DATA unless an explicit zero-result rule qualifies.
- Stale data blocks action creation.
- CBO/ABO scale ownership is correct.
- Equal-priority conflicting actions return REVIEW_MANUALLY.
- Evidence identifies exact winning rule window.
- Action history survives refresh.
- DONE evidence is not queued again until evidence changes.
- Noti/Panasonic AI playbooks expose limitations for missing metrics.

## 8. Release state

### Implemented

- Complete Browser workspace employee flow.
- Stateless normalize/optimize/backtest APIs.
- Optional authenticated Firebase persistence APIs.
- Multi-provider BYOK AI diagnostics.
- Noti and Panasonic playbooks.
- Unit/regression tests and browser E2E.

### Requires organization configuration

- Firebase project, user provisioning and custom claims for shared team mode.
- Scheduled connector/n8n ingestion.
- Production access control policy.
- Real provider API keys.

### Future

- UI switch from Browser workspace to Firebase team workspace.
- Scheduled automatic runs.
- Meta Marketing API execution after SOP/rules are stable.
- Rule-library master sync and template migrations.
