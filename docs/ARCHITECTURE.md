# Architecture

## Boundary map

1. **Ingestion** normalizes Meta/connector data into the data contract.
2. **Metric engine** produces daily entity aggregates and lookback windows.
3. **Deterministic rule engine** creates explainable recommendations.
4. **Action workflow** handles approval, execution status and append-only audit.
5. **AI diagnostics** analyzes supporting metrics but cannot override or execute rules.

## Firebase collections

- `organizations/{organizationId}`
- `projects/{projectId}`
- `projects/{projectId}/metricMappings/{mappingId}`
- `projects/{projectId}/rules/{ruleId}`
- `projects/{projectId}/dailyEntityMetrics/{metricId}`
- `projects/{projectId}/actionQueue/{actionId}`
- `projects/{projectId}/actionLog/{eventId}`
- `organizations/{organizationId}/aiProviders/{providerId}`
- `organizations/{organizationId}/analysisPlaybooks/{playbookId}`

Raw data should be stored outside hot dashboard reads. Generate daily aggregates during ingestion rather than scanning raw documents from the UI.

## AI trust boundary

- Provider keys are server-only and encrypted before persistence.
- Every analysis stores provider, model, playbook IDs/versions, input snapshot hash and output.
- AI receives the deterministic decision as immutable context.
- AI output is schema-validated.
- AI can explain, hypothesize and suggest checks; it cannot execute an ad action.
