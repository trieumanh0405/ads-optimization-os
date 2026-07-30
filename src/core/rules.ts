import type { ActionCode, MetricDefinition, OptimizationRule, OptimizationScope, ProjectConfig } from "./schemas";
import type { EntityEvidence, WindowId } from "./windows";
import { contextGeometricAchievement } from "./windows";

export type Recommendation = {
  scopeId: string;
  scopeName: string;
  ruleSetId: string;
  ruleVersion: number;
  entityLevel: EntityEvidence["entityLevel"];
  entityId: string;
  entityName: string;
  campaignId: string;
  adsetId: string | null;
  currentStatus: string;
  budgetType: EntityEvidence["budgetType"];
  recommendedAction: ActionCode;
  adjustmentPct: number | null;
  reasonCodes: string[];
  matchedRuleIds: string[];
  evidenceWindow: string;
  currentMetric: number | null;
  evaluatedValue: number | null;
  targetMetric: number;
  weightedAchievement: number | null;
  contextWeightedAchievement: number | null;
  cohortWeightedAchievement: number | null;
  cohortBenchmark: number | null;
  minimumWindowAchievement: number | null;
  trendRatio: number | null;
  redFlagWindowIds: string[];
  confidence: number;
  executionPhase: 1 | 2 | 3;
  windowMetrics: Array<{
    id: WindowId;
    label: string;
    role: string;
    includeInScore: boolean;
    start: string;
    endExclusive: string;
    value: number | null;
    achievement: number | null;
    spend: number;
    result: number | null;
    rowCount: number;
  }>;
};

function matches(value: number, rule: OptimizationRule): boolean {
  if (rule.operator === "LT") return value < rule.thresholdFrom;
  if (rule.operator === "LTE") return value <= rule.thresholdFrom;
  if (rule.operator === "GT") return value > rule.thresholdFrom;
  if (rule.operator === "GTE") return value >= rule.thresholdFrom;
  return value >= rule.thresholdFrom && value < (rule.thresholdTo ?? Number.POSITIVE_INFINITY);
}

function evidenceWindowLabel(source: string): string {
  return source.replaceAll("_PLUS_", " + ");
}

function scoreFor(rule: OptimizationRule, entity: EntityEvidence, all: EntityEvidence[]): number | null {
  if (rule.evaluationField === "ACHIEVEMENT") {
    if (["WEIGHTED", "GEOMETRIC", "PLAN_GEOMETRIC"].includes(rule.scoreSource)) return entity.weightedAchievement;
    if (["CONTEXT_WEIGHTED", "CONTEXT_GEOMETRIC"].includes(rule.scoreSource)) return contextGeometricAchievement(entity, all);
    if (rule.scoreSource === "COHORT_GEOMETRIC") return entity.cohortWeightedAchievement;
    if (rule.scoreSource === "MIN_WINDOW") return entity.minimumWindowAchievement;
    if (rule.scoreSource === "TREND") return entity.trendRatio;
    return entity.windows[rule.scoreSource as WindowId]?.achievement ?? null;
  }
  if (["WEIGHTED", "GEOMETRIC", "PLAN_GEOMETRIC", "CONTEXT_WEIGHTED", "CONTEXT_GEOMETRIC", "COHORT_GEOMETRIC", "MIN_WINDOW", "TREND"].includes(rule.scoreSource)) return null;
  const window = entity.windows[rule.scoreSource as WindowId];
  if (!window) return null;
  if (rule.evaluationField === "METRIC_VALUE") return window.value;
  if (rule.evaluationField === "SPEND") return window.totals.spend;
  if (rule.evaluationField === "RESULTS") return window.totals.result;
  if (rule.evaluationField === "QUALIFIED_RESULTS") return window.totals.qualifiedResult;
  return window.totals.revenue;
}

export function ownsBudget(entity: EntityEvidence): boolean {
  if (entity.entityLevel === "AD") return false;
  if (entity.entityLevel === "CAMPAIGN") return entity.budgetType === "CBO";
  return entity.budgetType === "ABO";
}

function isBudgetAction(action: ActionCode): boolean {
  return action === "INCREASE_BUDGET" || action === "DECREASE_BUDGET";
}

function isActiveStatus(status: string): boolean {
  return ["ACTIVE", "ENABLED", "DELIVERING"].includes(status.toUpperCase());
}

function evidenceSourceIds(entity: EntityEvidence, source: string): WindowId[] {
  if (source === "ALL_SCORE_WINDOWS") {
    return Object.values(entity.windows)
      .filter((window): window is NonNullable<typeof window> => Boolean(window?.includeInScore))
      .map((window) => window.id);
  }
  return source.includes("_PLUS_") ? source.split("_PLUS_") : [source];
}

function evidenceForRule(entity: EntityEvidence, rule: OptimizationRule, config: ProjectConfig, definition: MetricDefinition): boolean {
  const sourceIds = evidenceSourceIds(entity, rule.evidenceSource);
  const windows = sourceIds.map((id) => entity.windows[id]).filter((item): item is NonNullable<typeof item> => item !== null);
  if (windows.length !== sourceIds.length || windows.some((window) => !window.eligible)) return false;
  const spendThreshold = Math.max(rule.minSpendAbsolute ?? 0, (rule.minSpendTargetMultiple ?? 0) * config.target);
  const spend = windows.reduce((sum, item) => sum + item.totals.spend, 0);
  const evidenceCount = windows.reduce((sum, item) => sum + (definition.denominator === "qualifiedResult"
    ? (item.totals.qualifiedResult ?? 0) : (item.totals.result ?? 0)), 0);
  return spend >= spendThreshold && evidenceCount >= rule.minResults;
}

function confidence(entity: EntityEvidence, rule: OptimizationRule, definition: MetricDefinition): number {
  const sourceIds = evidenceSourceIds(entity, rule.evidenceSource);
  const sources = sourceIds.map((id) => entity.windows[id]).filter((item): item is NonNullable<typeof item> => item !== null);
  if (!sources.length) return 0;
  const evidenceCount = sources.reduce((sum, source) => sum + (definition.denominator === "qualifiedResult"
    ? (source.totals.qualifiedResult ?? 0) : (source.totals.result ?? 0)), 0);
  const resultConfidence = Math.min(1, evidenceCount / Math.max(1, rule.minResults * 2));
  const rowConfidence = Math.min(1, sources.reduce((sum, source) => sum + source.rowCount, 0) / 3);
  return Number(((resultConfidence * 0.7) + (rowConfidence * 0.3)).toFixed(3));
}

export function evaluateEntity(
  entity: EntityEvidence,
  all: EntityEvidence[],
  rules: OptimizationRule[],
  config: ProjectConfig,
  definition: MetricDefinition,
  scope: OptimizationScope
): Recommendation {
  const relevant = rules.filter((rule) =>
    rule.enabled && rule.ruleSetId === config.ruleSetId && rule.version === config.ruleVersion
    && rule.entityLevel === entity.entityLevel && rule.metricKey === config.primaryMetricKey
  );
  const scored = relevant.map((rule) => ({ rule, score: scoreFor(rule, entity, all) }));
  const evidenced = scored.filter((item) => item.score !== null && evidenceForRule(entity, item.rule, config, definition));
  const matched = evidenced.filter((item) => matches(item.score as number, item.rule));
  const contextScore = contextGeometricAchievement(entity, all);
  const todayWindow = Object.values(entity.windows).find((window) => window?.role === "SIGNAL")
    ?? Object.values(entity.windows)[0];
  const todayMetric = todayWindow?.value ?? null;
  const base = {
    scopeId: scope.scopeId, scopeName: scope.name, ruleSetId: scope.ruleSetId, ruleVersion: scope.ruleVersion,
    entityLevel: entity.entityLevel, entityId: entity.entityId, entityName: entity.entityName,
    campaignId: entity.campaignId, adsetId: entity.adsetId, currentStatus: entity.status, budgetType: entity.budgetType,
    evidenceWindow: `Configured: ${config.windows.map((item) => item.id).join(" + ")}`, currentMetric: todayMetric,
    evaluatedValue: null,
    targetMetric: scope.planTarget, weightedAchievement: entity.weightedAchievement,
    contextWeightedAchievement: contextScore, executionPhase: (entity.entityLevel === "AD" ? 1 : entity.entityLevel === "ADSET" ? 2 : 3) as 1 | 2 | 3,
    cohortWeightedAchievement: entity.cohortWeightedAchievement,
    cohortBenchmark: entity.cohortBenchmark,
    minimumWindowAchievement: entity.minimumWindowAchievement,
    trendRatio: entity.trendRatio,
    redFlagWindowIds: entity.redFlagWindowIds,
    windowMetrics: config.windows.flatMap((item) => {
      const window = entity.windows[item.id];
      return window ? [{
        id: item.id,
        label: window.label,
        role: window.role,
        includeInScore: window.includeInScore,
        start: window.start,
        endExclusive: window.endExclusive,
        value: window.value,
        achievement: window.achievement,
        spend: window.totals.spend,
        result: window.totals.result,
        rowCount: window.rowCount
      }] : [];
    })
  };
  if (!relevant.length) return { ...base, recommendedAction: "REVIEW_MANUALLY", adjustmentPct: null, reasonCodes: ["NO_RULES_CONFIGURED"], matchedRuleIds: [], confidence: 0 };
  if (!evidenced.length) return { ...base, recommendedAction: "PENDING_DATA", adjustmentPct: null, reasonCodes: ["MINIMUM_EVIDENCE_NOT_MET"], matchedRuleIds: [], confidence: 0 };
  if (!matched.length) return { ...base, recommendedAction: "REVIEW_MANUALLY", adjustmentPct: null, reasonCodes: ["NO_RULE_MATCH"], matchedRuleIds: [], confidence: 0.25 };
  const topPriority = Math.max(...matched.map((item) => item.rule.priority));
  const winners = matched.filter((item) => item.rule.priority === topPriority);
  const actions = new Set(winners.map((item) => item.rule.actionCode));
  if (actions.size > 1) return {
    ...base,
    evidenceWindow: [...new Set(winners.map((item) => evidenceWindowLabel(item.rule.evidenceSource)))].join(" / "),
    recommendedAction: "REVIEW_MANUALLY",
    adjustmentPct: null,
    reasonCodes: ["CONFLICTING_RULES"],
    matchedRuleIds: winners.map((item) => item.rule.id),
    confidence: 0.5
  };
  let action = winners[0].rule.actionCode;
  let adjustment = winners[0].rule.actionValue;
  const reasons = [`RULE_${winners[0].rule.id}`];
  if (action === "TURN_OFF" && !isActiveStatus(entity.status)) {
    action = "KEEP"; adjustment = null; reasons.push("ENTITY_ALREADY_INACTIVE");
  } else if (isBudgetAction(action) && !isActiveStatus(entity.status)) {
    action = "REVIEW_MANUALLY"; adjustment = null; reasons.push("INACTIVE_ENTITY_CANNOT_SCALE");
  }
  if (entity.entityLevel === "AD" && isBudgetAction(action)) {
    action = "REVIEW_MANUALLY"; adjustment = null; reasons.push("AD_CANNOT_OWN_BUDGET");
  } else if (isBudgetAction(action) && !ownsBudget(entity)) {
    action = "REVIEW_MANUALLY"; adjustment = null; reasons.push("ENTITY_DOES_NOT_OWN_BUDGET");
  }
  if (isBudgetAction(action) && adjustment !== null && Math.abs(adjustment) > config.maxDailyScalePct) {
    adjustment = Math.sign(adjustment) * config.maxDailyScalePct; reasons.push("ADJUSTMENT_CAPPED_BY_GUARDRAIL");
  }
  if (action === "INCREASE_BUDGET" && entity.minimumWindowAchievement !== null
    && entity.minimumWindowAchievement < scope.scaleMinWindowAchievement) {
    action = "REVIEW_MANUALLY";
    adjustment = null;
    reasons.push("MINIMUM_WINDOW_BELOW_SCALE_FLOOR");
  }
  if (action === "INCREASE_BUDGET" && contextScore !== null
    && contextScore < scope.contextScaleMinAchievement) {
    action = "REVIEW_MANUALLY";
    adjustment = null;
    reasons.push("CONTEXT_BELOW_SCALE_GUARDRAIL");
  }
  if (action === "INCREASE_BUDGET" && entity.cohortWeightedAchievement !== null
    && entity.cohortWeightedAchievement < 1) {
    action = "REVIEW_MANUALLY";
    adjustment = null;
    reasons.push("COHORT_BELOW_SCALE_GUARDRAIL");
  }
  if ((action === "TURN_OFF" || action === "DECREASE_BUDGET")
    && entity.weightedAchievement !== null && entity.weightedAchievement < 1
    && entity.cohortWeightedAchievement !== null && entity.cohortWeightedAchievement >= 1) {
    action = "REVIEW_MANUALLY";
    adjustment = null;
    reasons.push("BELOW_PLAN_BUT_COMPETITIVE_WITH_COHORT");
  }
  if (entity.redFlagWindowIds.length) {
    reasons.push(`WINDOW_RED_FLAG_${entity.redFlagWindowIds.join("_")}`);
    if (action === "KEEP" || action === "INCREASE_BUDGET") {
      action = "REVIEW_MANUALLY";
      adjustment = null;
    }
  }
  return {
    ...base, evidenceWindow: evidenceWindowLabel(winners[0].rule.evidenceSource),
    evaluatedValue: winners[0].score, recommendedAction: action, adjustmentPct: adjustment, reasonCodes: reasons,
    matchedRuleIds: winners.map((item) => item.rule.id), confidence: confidence(entity, winners[0].rule, definition)
  };
}

export function applyCrossEntityGuardrails(recommendations: Recommendation[], config: ProjectConfig): Recommendation[] {
  let scaleCount = 0;
  const childActions = recommendations.filter((item) => item.executionPhase === 1 && item.recommendedAction === "TURN_OFF");
  return recommendations
    .sort((a, b) => a.executionPhase - b.executionPhase || b.confidence - a.confidence)
    .map((item) => {
      let next = item;
      if (item.recommendedAction === "INCREASE_BUDGET") {
        scaleCount += 1;
        if (scaleCount > config.maxDailyScaleActions) next = { ...next, recommendedAction: "REVIEW_MANUALLY", adjustmentPct: null, reasonCodes: [...next.reasonCodes, "DAILY_SCALE_LIMIT_REACHED"] };
      }
      const hasChildTurnOff = childActions.some((child) =>
        item.entityLevel === "CAMPAIGN" ? child.campaignId === item.entityId
          : item.entityLevel === "ADSET" ? child.adsetId === item.entityId : false
      );
      if (config.deferParentScaleWhenChildAction && hasChildTurnOff && item.recommendedAction === "INCREASE_BUDGET") {
        next = { ...next, recommendedAction: "REVIEW_MANUALLY", adjustmentPct: null, reasonCodes: [...next.reasonCodes, "EXECUTE_CHILD_ACTIONS_FIRST"] };
      }
      return next;
    });
}
