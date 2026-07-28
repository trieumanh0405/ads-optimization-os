# Contributing

1. Create a short-lived branch from `main`.
2. Keep formulas, QC, rules and action lifecycle in `src/core`; React must not implement a second version.
3. Add regression tests for every rule behavior or data guardrail change.
4. Keep brand-specific field logic in mapping/config, not hard-coded by project name.
5. Add AI providers behind `AiProvider`.
6. Version playbooks whenever analysis instructions change.
7. Never commit API keys, Supabase service-role credentials, customer exports or workspace backups.
8. Preserve append-only audit semantics and terminal action statuses.
9. Update PRD/API docs when a contract changes.
10. Run `pnpm typecheck`, `pnpm test` and `pnpm build` before opening a PR.

Use conventional commits, for example:

```text
feat: add custom metric operands
fix: deduplicate terminal actions by evidence
docs: clarify browser and team persistence
```

## Definition of done

- TypeScript passes in strict mode.
- Core unit/regression tests pass.
- Production build succeeds.
- Browser E2E covers the changed employee workflow.
- Empty/missing data remains `null`.
- No new provider key or customer data is stored client-side without explicit UI disclosure.
