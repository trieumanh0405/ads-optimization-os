# Core engine specification

This document is the source of truth for optimization formulas. UI code must not duplicate or redefine these rules.

## Product purpose

The product is a decision-support operating system for trained media buyers. It reduces review time, prevents hidden weak entities from being skipped, and makes decisions consistent across a team. It does not claim to replace optimization judgment and does not execute Meta actions in v1.

Evaluation runs bottom-up: Ad → Ad set → Campaign. The output contains an execution phase so child actions can be completed before parent scaling.

## Canonical data

Each normalized fact requires project/account/date/entity identity, status, budget ownership, spend, source freshness and a stable source row key. Optional metrics remain `null`; they are never converted to zero.

Brand-specific exports are transformed through explicit source mappings. Strict import rejects the batch when any row is invalid. Partial import accepts valid rows and returns row-level errors.

## Metric formulas

Metrics are records, not hard-coded conditionals:

- `CPL = spend / result`
- `CPQL = spend / qualifiedResult`
- `CPA = spend / result`
- `ROAS = revenue / spend`
- `CTR (%) = clicks / impressions × 100`
- `CPC = spend / clicks`
- `CVR (%) = result / clicks × 100`
- `CPM = spend / impressions × 1,000`

If the denominator is zero or absent, the metric is `null`.

Custom metric definitions can use canonical fields or a mapped operand such as `metrics.bookedAppointment`.

Achievement always uses “higher is better” orientation:

- Lower-is-better: `achievement = target / actual`
- Higher-is-better: `achievement = actual / target`

## Evidence windows

- `TODAY`: `[asOfDate, asOfDate + 1 day)`
- `SHORT`: `[asOfDate - shortDays, asOfDate)`
- `LONG`: `[asOfDate - longDays, asOfDate)`
- `LIFETIME`: `[projectStartDate, asOfDate + 1 day)`

Today is excluded from SHORT and LONG. A weighted score renormalizes available optional windows, but missing required windows returns `null`.

`windowScore = Π(MIN(achievement, cap)^(weight/totalWeight))` which is computed as `exp(Σ((weight/totalWeight) × ln(MIN(achievement, cap))))`

Note that:
- Zero achievement with evidence collapses score to 0
- Missing windows are excluded and remaining weights normalized
- Values are capped (default cap=2) so one exceptional window cannot hide a weak one
- This is the weighted geometric mean, NOT arithmetic average

## Entity and context score

The second weighting layer implements the transcript’s “entity vs total” concept:

`decisionScore = entityWindowScore × entityWeight + contextWindowScore × contextWeight`

- Campaign context: project overall
- Ad set context: parent Campaign, falling back to project
- Ad context: parent Ad set, then Campaign, then project

Both weights must sum to 1 for every entity level.

## Rule evaluation

Rules independently select a score source (`TODAY`, `SHORT`, `LONG`, `LIFETIME`, `WEIGHTED`, `CONTEXT_WEIGHTED`), evaluation field (`ACHIEVEMENT`, `METRIC_VALUE`, `SPEND`, `RESULTS`, `QUALIFIED_RESULTS`, `REVENUE`) and evidence source (`TODAY`, `SHORT`, `LONG`, `LIFETIME`, `TODAY_PLUS_SHORT`, `TODAY_PLUS_LONG`). This avoids hiding a hard-coded evidence window inside weighted formulas and lets zero-result spend rules run even when CPL/CPA is null.

1. Block stale/invalid data.
2. Remove rules from other sets/versions/entity levels/metrics.
3. Require minimum spend and result evidence configured by the rule.
4. Match thresholds against the selected evaluation field.
5. Choose the highest numeric priority.
6. If top-priority rules produce different actions, return `REVIEW_MANUALLY`.
7. Apply budget ownership and scale guardrails.

## Budget ownership

- Campaign owns budget only for CBO.
- Ad set owns budget only for ABO.
- Ad never owns budget.

Invalid budget actions become `REVIEW_MANUALLY`; they are not silently applied to the parent.

## Data quality blockers

Empty data, stale refresh, duplicate source keys, missing entity IDs, project mismatch, undefined primary metric, invalid weights and invalid target-multiple evidence rules block the run. Future rows are ignored with a warning.

## Action lifecycle

Action fingerprints include entity, action, evidence and rule IDs. An equivalent action is not duplicated in later runs while the evidence hash is unchanged, including when the previous action is terminal. Changed evidence produces a new action. Valid transitions:

- `PENDING → DONE | REJECTED | DEFERRED`
- `DEFERRED → PENDING | DONE | REJECTED`

DONE and REJECTED are terminal. Every transition appends an immutable Action Log event.

## Backtesting

Backtesting calls the same engine for explicit `{asOfDate, runAt}` checkpoints. It never uses a separate simplified formula. Each run applies the same QC, evidence, rule and guardrail path as a live run.

## AI boundary

AI receives the deterministic recommendation and supporting metric snapshot. It may return observations, hypotheses and suggested checks. It cannot override rule output or execute an ad action. Provider/model/playbook versions are recorded for reproducibility.
