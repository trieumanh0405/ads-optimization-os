# Changelog

All notable changes to this project will be documented in this file.

---

## [1.2.0] — 2026-08-06 — Phase 2: Modular Refactor + Security + Performance

### 🗂️ Backend Modularization
- **Split `project-store.ts`** (392 LOC god module) into 6 focused modules:
  - `projects/project-access.ts` — ACL & authorization
  - `projects/project-repository.ts` — CRUD operations
  - `projects/fact-import-service.ts` — CSV import & normalization
  - `projects/google-sync-service.ts` — Google Sheets sync
  - `projects/engine-runner.ts` — Optimization engine execution
  - `projects/action-service.ts` — Action state machine
- Original file converted to barrel re-export for backward compatibility

### 🏗️ Frontend Component Extraction
- **Decomposed `workspace-app.tsx`** from 1,535 LOC → 466 LOC (-70%):
  - `components/helpers/format-utils.ts` — Shared formatting utilities
  - `components/dialogs/create-project-dialog.tsx` — Project creation dialog
  - `components/dialogs/team-access-dialog.tsx` — Team member management
  - `components/shell/supabase-team-entry.tsx` — Auth entry point
  - `components/shell/workspace-sidebar.tsx` — Navigation sidebar
  - `components/shell/workspace-topbar.tsx` — Project selector & actions
  - `components/views/overview-view.tsx` — Dashboard overview
  - `components/views/project-setup-view.tsx` — Project & KPI configuration
  - `components/views/decision-board.tsx` — Recommendation table & evidence
  - `components/views/action-queue.tsx` — Action approval workflow
  - `components/views/runs-audit.tsx` — Run history & audit log

### 🔐 Security Enhancements
- **HKDF key derivation** replaces raw SHA-256 in `secret-crypto.ts`
  - New `v2.` encrypted format with hex encoding
  - Full backward compatibility with `v1.` legacy payloads
  - Minimum 32-char secret enforcement
- **Removed `sessionStorage` API key storage** from `ai-analysis-panel.tsx`
  - API keys now server-side only (encrypted in DB, decrypted per-request)
  - Client sends `providerId`, never raw key
- **Functional Provider Dialog** — full CRUD for AI provider management
  - List, create, delete providers via `/api/ai/providers`
  - Masked key display (`sk-****...1234`)

### ⚡ Performance
- **CSV Web Worker** — parsing, normalization, and classification run off main thread
  - `workers/csv-processor.worker.ts` — 3-stage pipeline with progress events
  - `hooks/use-csv-worker.ts` — React hook with progress state & cancel
  - Graceful fallback to main thread if Worker fails
  - Progress UI with Vietnamese stage labels

---

## [1.1.0] — 2026-08-06 — Phase 1: Critical Fixes

### 🔐 Security
- Moved Gemini API key from URL parameter to `x-goog-api-key` header
- Added Supabase auth middleware to `/api/optimize`, `/api/normalize`, `/api/backtest`
- Added 20,000 row cap on normalize endpoint

### 🐛 Bug Fixes (Core Engine)
- Fixed `isoDate()` timezone shift — was using local time instead of UTC
- Fixed `achievement()` returning `Infinity` for zero-value `LOWER_IS_BETTER` metrics
- Fixed `evidenceForRule` denominator — was dividing by wrong window count
- Fixed `actionKey` float precision — used `toFixed(6)` for deterministic dedup
- Fixed `applyCrossEntityGuardrails` — was mutating input array via `.sort()`
- Fixed `field in fact` — replaced with `Object.hasOwn()` to avoid prototype pollution

### ⚡ Performance
- Reduced 8 QC passes to 1 single-pass scan
- Eliminated duplicate `buildEntityEvidence` calls
- Pre-sorted rules in `classifyFacts` for O(1) priority lookup
- Pre-indexed facts in `buildEntityEvidence` for O(1) entity lookup

### 🧪 Testing
- Expanded test suite: 38 → 82 tests (all passing)
- New test files: `schemas.test.ts`, `qc.test.ts`, `backtest.test.ts`, `library.test.ts`
- Expanded: `metrics.test.ts`, `windows.test.ts`, `rules.test.ts`, `normalize.test.ts`, `scopes.test.ts`

### 📝 Documentation
- Fixed `CORE_ENGINE.md` — corrected scoring formula to weighted geometric mean
- Fixed `pnpm-workspace.yaml` — replaced string placeholder with boolean
- Added `engines` and `packageManager` fields to `package.json`
- Unified type authority: `core/schemas.ts` as single source of truth

---

## [1.0.0] — Initial Release
- Core optimization engine with QC → Scope → Window → Metrics → Rules → Actions pipeline
- Multi-provider AI diagnostics (OpenAI, Anthropic, Gemini)
- Google Sheets integration
- Supabase team mode with RLS
- IndexedDB local persistence
