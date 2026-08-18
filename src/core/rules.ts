import type { ActionCode, MetricDefinition, OptimizationRule, OptimizationScope, ProjectConfig } from "./schemas";
import type { EntityEvidence, WindowId } from "./windows";
import { contextAchievementFor, effectivePlanTarget } from "./windows";
import type { MetricTotals } from "./metrics";

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
  /** Entity score after blending with its context; this is what rules matched. */
  blendedAchievement: number | null;
  contextWeightedAchievement: number | null;
  cohortWeightedAchievement: number | null;
  cohortBenchmark: number | null;
  cohortRank: number | null;
  cohortSize: number | null;
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

/**
 * Projects created before the geometric-score migration stored
 * CONTEXT_WEIGHTED as their default score source. Treat that legacy value as
 * Plan geometric; Context is now evaluated separately by CONTEXT_GEOMETRIC
 * and by the scale guardrail.
 */
export function canonicalScoreSource(source: string): string {
  if (source === "WEIGHTED" || source === "CONTEXT_WEIGHTED") return "GEOMETRIC";
  return source;
}

const AGGREGATE_SCORE_SOURCES = [
  "GEOMETRIC", "PLAN_GEOMETRIC", "ENTITY_GEOMETRIC",
  "CONTEXT_GEOMETRIC", "COHORT_GEOMETRIC", "MIN_WINDOW", "TREND"
];

function scoreFor(
  rule: OptimizationRule,
  entity: EntityEvidence,
  all: EntityEvidence[],
  scope: OptimizationScope
): number | null {
  const scoreSource = canonicalScoreSource(rule.scoreSource);
  if (rule.evaluationField === "ACHIEVEMENT") {
    // The plan score a rule matches is the blended one, so the configured
    // entity/context weights actually drive decisions. With context weight 0
    // the blend equals the raw entity score.
    if (["GEOMETRIC", "PLAN_GEOMETRIC"].includes(scoreSource)) {
      return entity.blendedAchievement ?? entity.weightedAchievement;
    }
    if (scoreSource === "ENTITY_GEOMETRIC") return entity.weightedAchievement;
    if (scoreSource === "CONTEXT_GEOMETRIC") return contextAchievementFor(entity, all, scope);
    if (scoreSource === "COHORT_GEOMETRIC") return entity.cohortWeightedAchievement;
    if (scoreSource === "MIN_WINDOW") return entity.minimumWindowAchievement;
    if (scoreSource === "TREND") return entity.trendRatio;
    return entity.windows[scoreSource as WindowId]?.achievement ?? null;
  }
  if (AGGREGATE_SCORE_SOURCES.includes(scoreSource)) return null;
  const window = entity.windows[scoreSource as WindowId];
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

function getDenominatorEvidence(totals: MetricTotals, definition: MetricDefinition): number {
  if (definition.denominator === "qualifiedResult") return totals.qualifiedResult ?? 0;
  if (definition.denominator === "result") return totals.result ?? 0;
  if (definition.denominator === "clicks") return totals.clicks ?? 0;
  if (definition.denominator === "impressions") return totals.impressions ?? 0;
  return totals.result ?? 0;
}

function evidenceForRule(entity: EntityEvidence, rule: OptimizationRule, config: ProjectConfig, definition: MetricDefinition): boolean {
  const sourceIds = evidenceSourceIds(entity, rule.evidenceSource);
  const windows = sourceIds.map((id) => entity.windows[id]).filter((item): item is NonNullable<typeof item> => item !== null);
  if (windows.length !== sourceIds.length || windows.some((window) => !window.eligible)) return false;
  const spendThreshold = Math.max(rule.minSpendAbsolute ?? 0, (rule.minSpendTargetMultiple ?? 0) * config.target);
  const spend = windows.reduce((sum, item) => sum + item.totals.spend, 0);
  const evidenceCount = windows.reduce((sum, item) => sum + getDenominatorEvidence(item.totals, definition), 0);
  return spend >= spendThreshold && evidenceCount >= rule.minResults;
}

/** Results and days of history that count as a full-strength sample. */
const FULL_CONFIDENCE_RESULTS = 20;
const FULL_CONFIDENCE_ROWS = 7;

/**
 * How much history stands behind this recommendation, on an absolute scale.
 *
 * Scaling by the rule's own minResults made almost every row read 100%, because
 * the default minimum is one result. Anchoring to a fixed sample size lets the
 * column separate a decision backed by three results from one backed by fifty.
 */
function confidence(entity: EntityEvidence, rule: OptimizationRule, definition: MetricDefinition): number {
  const sourceIds = evidenceSourceIds(entity, rule.evidenceSource);
  const sources = sourceIds.map((id) => entity.windows[id]).filter((item): item is NonNullable<typeof item> => item !== null);
  if (!sources.length) return 0;
  const evidenceCount = sources.reduce((sum, source) => sum + getDenominatorEvidence(source.totals, definition), 0);
  const rowCount = sources.reduce((sum, source) => sum + source.rowCount, 0);
  const resultConfidence = Math.min(1, evidenceCount / FULL_CONFIDENCE_RESULTS);
  const rowConfidence = Math.min(1, rowCount / FULL_CONFIDENCE_ROWS);
  return Number(((resultConfidence * 0.6) + (rowConfidence * 0.4)).toFixed(3));
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
  const scored = relevant.map((rule) => ({ rule, score: scoreFor(rule, entity, all, scope) }));
  const evidenced = scored.filter((item) => item.score !== null && evidenceForRule(entity, item.rule, config, definition));
  const matched = evidenced.filter((item) => matches(item.score as number, item.rule));
  const contextScore = entity.contextAchievement ?? contextAchievementFor(entity, all, scope);
  const todayWindow = Object.values(entity.windows).find((window) => window?.role === "SIGNAL")
    ?? Object.values(entity.windows)[0];
  const todayMetric = todayWindow?.value ?? null;
  const base = {
    scopeId: scope.scopeId, scopeName: scope.name, ruleSetId: scope.ruleSetId, ruleVersion: scope.ruleVersion,
    entityLevel: entity.entityLevel, entityId: entity.entityId, entityName: entity.entityName,
    campaignId: entity.campaignId, adsetId: entity.adsetId, currentStatus: entity.status, budgetType: entity.budgetType,
    evidenceWindow: `Configured: ${config.windows.map((item) => item.id).join(" + ")}`, currentMetric: todayMetric,
    evaluatedValue: null,
    targetMetric: effectivePlanTarget(scope, definition), weightedAchievement: entity.weightedAchievement,
    blendedAchievement: entity.blendedAchievement ?? entity.weightedAchievement,
    contextWeightedAchievement: contextScore, executionPhase: (entity.entityLevel === "AD" ? 1 : entity.entityLevel === "ADSET" ? 2 : 3) as 1 | 2 | 3,
    cohortWeightedAchievement: entity.cohortWeightedAchievement,
    cohortBenchmark: entity.cohortBenchmark,
    cohortRank: entity.cohortRank,
    cohortSize: entity.cohortSize,
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
  // Opt-in protection for an entity that misses an ambitious plan target while
  // still clearly outperforming its peers. This used to run unconditionally and
  // compared at exactly 100%, which vetoed nearly every decision in an account
  // whose overall performance sits below plan. It now requires an explicit
  // opt-in, a floor on plan achievement, and a clear margin over the cohort.
  const guard = scope.cohortGuard;
  if (guard.enabled
    && (action === "TURN_OFF" || action === "DECREASE_BUDGET")
    && entity.weightedAchievement !== null && entity.weightedAchievement < 1
    && entity.weightedAchievement >= guard.minPlanAchievement
    && entity.cohortWeightedAchievement !== null
    && entity.cohortWeightedAchievement >= guard.minCohortAchievement) {
    action = "REVIEW_MANUALLY";
    adjustment = null;
    reasons.push("BELOW_PLAN_BUT_COMPETITIVE_WITH_COHORT");
  }
  // A red flag qualifies a decision to keep or scale: the entity looks
  // acceptable overall but one window is weak. It blocks scaling and is
  // reported alongside a KEEP. On an entity already being turned off or scaled
  // down it repeats what the score has said, so it is left out of the reasons.
  if (entity.redFlagWindowIds.length && action !== "TURN_OFF" && action !== "DECREASE_BUDGET") {
    reasons.push(`WINDOW_RED_FLAG_${entity.redFlagWindowIds.join("_")}`);
    if (action === "INCREASE_BUDGET") {
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
  return [...recommendations]
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
