import type { MetricSnapshot, OptimizationRule, RuleDecision } from "./types";

function compare(value: number, rule: OptimizationRule): boolean {
  if (rule.operator === "lt") return value < rule.thresholdFrom;
  if (rule.operator === "lte") return value <= rule.thresholdFrom;
  if (rule.operator === "gt") return value > rule.thresholdFrom;
  if (rule.operator === "gte") return value >= rule.thresholdFrom;
  return value >= rule.thresholdFrom && value <= (rule.thresholdTo ?? rule.thresholdFrom);
}

export function evaluateRules(
  snapshot: MetricSnapshot,
  rules: OptimizationRule[]
): RuleDecision {
  if (!snapshot.dataFresh || snapshot.value === null) {
    return {
      action: "PENDING_DATA",
      reasonCodes: ["DATA_NOT_READY"],
      matchedRuleIds: [],
      confidence: "LOW"
    };
  }

  const eligible = rules.filter(
    (rule) =>
      rule.enabled &&
      rule.metricKey === snapshot.metricKey &&
      snapshot.spend >= rule.minSpend &&
      snapshot.results >= rule.minResults &&
      compare(snapshot.value as number, rule)
  );

  if (!eligible.length) {
    return {
      action: "PENDING_DATA",
      reasonCodes: ["MINIMUM_EVIDENCE_NOT_REACHED"],
      matchedRuleIds: [],
      confidence: "LOW"
    };
  }

  const topPriority = Math.max(...eligible.map((rule) => rule.priority));
  const winners = eligible.filter((rule) => rule.priority === topPriority);
  const actions = new Set(winners.map((rule) => rule.action));

  if (actions.size > 1) {
    return {
      action: "REVIEW_MANUALLY",
      reasonCodes: ["CONFLICTING_RULES"],
      matchedRuleIds: winners.map((rule) => rule.id),
      confidence: "MEDIUM"
    };
  }

  return {
    action: winners[0].action,
    adjustmentPct: winners[0].adjustmentPct,
    reasonCodes: [`RULE_${winners[0].id}`],
    matchedRuleIds: winners.map((rule) => rule.id),
    confidence: snapshot.results >= winners[0].minResults * 2 ? "HIGH" : "MEDIUM"
  };
}
