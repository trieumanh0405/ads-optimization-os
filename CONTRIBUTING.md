# Contributing to Ads Optimization OS

## Quick Start

```bash
pnpm install
pnpm typecheck   # TypeScript strict — 0 errors required
pnpm test         # Vitest — all tests must pass
pnpm dev          # Next.js dev server
pnpm build        # Production build
```

## Architecture Overview

See [docs/CORE_ENGINE.md](docs/CORE_ENGINE.md) for the optimization engine pipeline.

### Directory Structure

```
src/
├── core/           # Pure deterministic engine (zero side effects)
├── ai/             # AI provider abstraction (BYOK multi-provider)
├── server/         # Backend services (Supabase + auth + encrypted storage)
│   └── projects/   # Modular project services (6 focused modules)
├── app/api/        # Next.js API routes (all authenticated)
├── components/     # React UI
│   ├── shell/      # App shell (sidebar, topbar, auth)
│   ├── views/      # Feature views (overview, setup, decisions, actions, audit)
│   ├── dialogs/    # Modal dialogs
│   └── helpers/    # Shared utilities
├── workers/        # Web Workers (CSV processing)
├── hooks/          # Custom React hooks
├── product/        # Product-layer utilities (persistence, team API, types)
└── domain/         # Legacy types (re-exports from core/schemas.ts)
```

### Key Design Principles

1. **Core is pure** — `src/core/` has zero side effects, no IO. Fully deterministic.
2. **Schema-first** — `core/schemas.ts` (Zod) is the single source of truth for all types.
3. **Barrel re-exports** — `project-store.ts` and `domain/types.ts` are re-export barrels. Import from them for backward compat.
4. **Server-side secrets** — API keys are NEVER stored client-side. Encrypted in DB, decrypted per-request.

### Decision Log

Key architectural decisions are documented in-repo:

| Decision | Choice | Why |
|---|---|---|
| Auth | Supabase Auth | Magic Link OTP, RLS |
| Types authority | `core/schemas.ts` | Zod = runtime + compile-time |
| Scoring formula | Weighted geometric mean | Better sensitivity to poor-performing metrics |
| Key derivation | HKDF (RFC 5869) | Stronger than SHA-256, backward compat with v1 |
| CSV processing | Web Worker | No main-thread blocking for large files |
| Frontend arch | Extracted components | 1535→466 LOC monolith decomposition |

## Development Rules

- **Test count only goes up** — never remove tests
- **No circular imports** — check with `madge` if unsure
- **Explicit props** — no `any` types in component props
- **Barrel re-exports** — when splitting a file, keep the original as re-export barrel
- **Vietnamese UI** — all user-facing strings in Vietnamese

## Running Tests

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
pnpm test -- src/core  # Run specific directory
```
