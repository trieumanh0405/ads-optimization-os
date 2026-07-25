# AI playbooks

## Integration model

The three supplied advertising-analysis sources were not copied into deterministic rules. They were normalized into versioned advisory playbooks in `src/ai/playbooks.ts`.

This separation prevents a qualitative framework or one brand case from silently turning ads off.

## Noti Meta performance

Source: `meta-ads-analyzer-mod-by-noti`.

Integrated guardrails:

- Data Quality Verdict first.
- Missing is not zero.
- Clicks (all) is not Link clicks.
- Mixed objectives must not share cost-per-result conclusions.
- Sample size, learning status, tracking confidence and CBO/ABO ownership matter.
- Breakdown averages do not prove marginal efficiency.
- Vietnam/SEA offline-close and messaging revenue require CRM/CAPI caution.

## Noti content, funnel & creative

Source: `content-insight-funnel-branding-planing`.

Integrated guardrails:

- Separate TOFU/MOFU/BOFU hypotheses.
- Distinguish hook, click intent, landing-page progression, lead quality and purchase completion.
- Recommend controlled tests with one variable and an observation window.
- Do not convert branding frameworks or budget splits into universal hard rules.

## Panasonic Vietnam case

Source: `panasonic_meta_ads_analysis.md`.

Integrated guardrails:

- Use fragmentation, budget alignment, event-volume and creative/funnel patterns as a checklist.
- Never reuse case-specific budgets, CPM, CPA or campaign counts as benchmarks.
- Compare campaigns within objective/role.
- Turn restructuring recommendations into testable hypotheses with rollback conditions.

## Output contract

AI output must contain:

- summary
- observations with metric and severity
- hypotheses
- suggested checks
- action commentary
- confidence
- limitations

The selected deterministic action is immutable context.
