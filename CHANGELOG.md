# Changelog

All notable changes to this project will be documented in this file.

---

## [1.4.0] — 2026-08-18 — One operating screen, plan tracking, readable decisions

### Added

- **Plan and pacing tracking.** A scope can state its plan on qualified results
  and bridge to reported ones with an estimate rate, matching the team's
  reference spreadsheet. The engine now returns, per scope: reported and
  estimated qualified volumes and costs, the reported-result target implied by
  the qualified target, plan achievement, how far through the plan period the
  account is, and the extra daily budget needed to land the plan by its end
  date. End-of-day projection extrapolates today once a quarter of the day has
  passed and falls back to the trailing daily average before that.
- **Merged operating screen.** Decision board and Action queue are one view.
  The same entity shows its decision, its evidence and its execution buttons on
  one row, so the two screens can no longer disagree about what is outstanding.
  Stored workspaces pointing at either old view land on the merged one.
- **Spreadsheet-style overview panel** above the table: actual vs plan, the
  configured window and scope weights, the threshold table with the current band
  marked, per-window cost and achievement, and the pacing figures.
- New project fields: plan end date, planned result volume, estimate rate,
  window blend method, context source, peer-benchmark leave-one-out, and the
  opt-in peer guard, all editable in Project setup.

### Fixed

- **Entity scores and the plan panel now share one scale.** With an estimate
  rate configured, entities were scored against the qualified-result target
  while the account summary compared like for like, so a fleet reading 38% of
  plan was made up of ads each reading over 100%.
- **Reason codes read as sentences.** `BELOW_PLAN_BUT_COMPETITIVE_WITH_COHORT`
  now reads "Dưới kế hoạch nhưng vẫn tốt hơn mặt bằng tài khoản"; raw codes stay
  in the evidence drawer for tracing.
- **Peer standing is legible.** The capped ratio read 200% on nearly every row;
  rows now carry a rank within the peer group.
- Achievement is shown against the 80/100/120 bands with a marked meter, so a
  number can be judged without consulting the threshold table.
- Sticky table header, one decision colour system, and a density-appropriate
  layout for a table that routinely runs to hundreds of rows.

---

## [1.3.0] — 2026-08-18 — Decision methodology corrections

Recommendations now reach a conclusion for entities that previously piled up in
manual review, and the configured weights and bands mean what they say.

### Fixed

- **Peer comparison no longer vetoes decisions.** A below-plan entity that beat
  the account average was forced to `REVIEW_MANUALLY` regardless of how far
  below plan it sat. Because the benchmark was the account's own aggregate, any
  account performing below plan sent almost every entity to manual review. On a
  20-ad simulation this alone stranded 35% of ads; the equivalent production run
  left 987 of 998 entities undecided. The comparison is now reporting only, with
  an opt-in `cohortGuard` that requires a plan floor and a clear peer margin.
- **The 80-100% band keeps an ad instead of turning it off.** The `watch` rule
  turned off ads inside the band the reference spreadsheet marks Keep/Active, so
  an ad at 96% of target was proposed for shutdown.
- **`contextWeights` now drives decisions.** The entity/context split was
  configurable in Project setup and stored, but no engine code ever read it. The
  documented second weighting layer was not implemented.
- **A zero cost-per-result is treated as missing evidence.** It previously
  scored 1000% achievement, letting one sync artefact rescue a weak entity.
- **Confidence separates thin evidence from thick.** It was scaled by the rule's
  own minimum, which is one result by default, so nearly every row read 100%.
- **A partial Today window no longer raises a red flag,** and a red flag no
  longer downgrades a healthy KEEP to manual review. It still blocks scaling.
- **Rule descriptions match their thresholds** (they described 70/95/120 bands
  while the code used 80/100/120).

### Added

- `windowBlendMethod` per scope: `ARITHMETIC` (default, matches the reference
  spreadsheet) or `GEOMETRIC` (stricter).
- `contextSource` per scope: `PARENT` (default) or `PROJECT`.
- Peer benchmark uses the median and excludes the entity being judged;
  recommendations carry `cohortRank` and `cohortSize`.
- Stored projects are upgraded on read through `methodologyVersion`.
- Decision board counts "chưa đủ dữ liệu" separately from "cần review tay".
- 21 regression tests covering every behaviour above.

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
