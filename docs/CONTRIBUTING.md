# Contributing

1. Create a short-lived branch from `main`.
2. Keep domain logic in `src/domain`; do not place business rules in React components.
3. Add tests for rule behavior and data guardrails.
4. Add AI providers behind the `AiProvider` contract.
5. Version playbooks whenever analysis instructions change.
6. Never commit API keys, Firebase credentials or exported customer data.
7. Run `pnpm typecheck`, `pnpm test` and `pnpm build` before opening a pull request.

Use conventional commits such as `feat: add rule conflict resolution`.
