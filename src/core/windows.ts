import type {
  EntityLevel,
  FactRow,
  MetricDefinition,
  OptimizationScope,
  ProjectConfig,
  WindowConfig
} from "./schemas";
import {
  achievement,
  computeMetric,
  median,
  mergeMetricTotals,
  sumFacts,
  weightedAverage,
  weightedGeometricMean,
  type MetricTotals
} from "./metrics";
import { resolvedWindows } from "./scopes";

export type WindowId = string;
export type WindowEvidence = {
  id: WindowId;
  label: string;
  role: WindowConfig["role"];
  includeInScore: boolean;
  start: string;
  endExclusive: string;
  totals: MetricTotals;
  value: number | null;
  achievement: number | null;
  rowCount: number;
  evidenceCount: number;
  eligible: boolean;
};
export type EntityEvidence = {
  scopeId: string;
  scopeName: string;
  entityLevel: EntityLevel;
  entityId: string;
  entityName: string;
  campaignId: string;
  adsetId: string | null;
  adId: string | null;
  status: string;
  budgetType: FactRow["budgetType"];
  windows: Record<WindowId, WindowEvidence | null>;
  weightedAchievement: number | null;
  minimumWindowAchievement: number | null;
  trendRatio: number | null;
  redFlagWindowIds: string[];
  projectWeightedAchievement: number | null;
  cohortWeightedAchievement: number | null;
  cohortBenchmark: number | null;
  /** 1 = best performer in the peer group over the cohort lookback. */
  cohortRank: number | null;
  cohortSize: number | null;
  /** Context score this entity is blended against (parent or project total). */
  contextAchievement: number | null;
  /** Entity score after the second weighting layer; this is what rules match. */
  blendedAchievement: number | null;
};

export function expandFactLevels(facts: FactRow[]): FactRow[] {
  // Note: Derived parent rows must be created for every child fact row to preserve dates and per-row metric values. Deduplicating them before aggregation would lose metric data and produce incorrect sum totals.
  const expanded = [...facts];
  const levels = new Set(facts.map((fact) => fact.entityLevel));
  if (!levels.has("ADSET")) {
    for (const fact of facts.filter((item) => item.entityLevel === "AD" && item.adsetId)) {
      expanded.push({
        ...fact,
        entityLevel: "ADSET",
        adId: null,
        entityName: fact.dimensions.adsetName ?? fact.adsetId ?? "Unknown ad set",
        sourceRowKey: `${fact.sourceRowKey}|DERIVED_ADSET`
      });
    }
  }
  if (!levels.has("CAMPAIGN")) {
    const campaignSource = levels.has("ADSET")
      ? facts.filter((item) => item.entityLevel === "ADSET")
      : facts.filter((item) => item.entityLevel === "AD");
    for (const fact of campaignSource) {
      expanded.push({
        ...fact,
        entityLevel: "CAMPAIGN",
        adsetId: null,
        adId: null,
        entityName: fact.dimensions.campaignName ?? fact.campaignId,
        sourceRowKey: `${fact.sourceRowKey}|DERIVED_CAMPAIGN`
      });
    }
  }
  return expanded;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function entityId(row: FactRow): string {
  if (row.entityLevel === "CAMPAIGN") return row.campaignId;
  if (row.entityLevel === "ADSET") return row.adsetId ?? "";
  return row.adId ?? "";
}

function windowKind(window: WindowConfig): "TODAY" | "ROLLING" | "LIFETIME" {
  if (window.kind) return window.kind;
  if (window.id.toUpperCase() === "TODAY") return "TODAY";
  if (window.id.toUpperCase() === "LIFETIME") return "LIFETIME";
  return "ROLLING";
}

export function windowBounds(window: WindowConfig, asOfDate: string, projectStartDate: string) {
  const kind = windowKind(window);
  if (kind === "TODAY") return { start: asOfDate, endExclusive: addDays(asOfDate, 1) };
  if (kind === "LIFETIME") return { start: projectStartDate, endExclusive: addDays(asOfDate, 1) };
  if (!window.days) throw new Error(`${window.id} requires a positive day count`);
  // Rolling windows intentionally exclude Today so a partial day does not
  // appear twice in the geometric score.
  return { start: addDays(asOfDate, -window.days), endExclusive: asOfDate };
}

function resultEvidence(totals: MetricTotals, definition: MetricDefinition): number {
  if (definition.denominator === "qualifiedResult") return totals.qualifiedResult ?? 0;
  if (definition.denominator === "result") return totals.result ?? 0;
  if (definition.denominator === "clicks") return totals.clicks ?? 0;
  if (definition.denominator === "impressions") return totals.impressions ?? 0;
  return totals.result ?? 0;
}

/**
 * Combine the configured time windows into a single entity score.
 *
 * ARITHMETIC reproduces the reference spreadsheet the team already trusts.
 * GEOMETRIC is stricter because a weak window drags the product down and a
 * single zero collapses the score outright.
 */
export function blendWindowScores(
  items: Array<{ value: number | null; weight: number; required?: boolean }>,
  cap: number,
  method: OptimizationScope["windowBlendMethod"]
): number | null {
  return method === "GEOMETRIC" ? weightedGeometricMean(items, cap) : weightedAverage(items, cap);
}

function windowScore(
  windows: Record<string, WindowEvidence | null>,
  configWindows: WindowConfig[],
  scope: OptimizationScope
): number | null {
  const included = configWindows.filter((window) => window.includeInScore && window.weight > 0);
  return blendWindowScores(included.map((window) => {
    const evidence = windows[window.id];
    return {
      value: evidence?.eligible ? evidence.achievement : null,
      weight: window.weight,
      required: window.required
    };
  }), scope.achievementCap, scope.windowBlendMethod);
}

function minimumScore(windows: Record<string, WindowEvidence | null>, configWindows: WindowConfig[]): number | null {
  const values = configWindows
    .filter((window) => window.includeInScore && window.weight > 0)
    .map((window) => windows[window.id])
    .filter((window): window is WindowEvidence => Boolean(window?.eligible && window.achievement !== null))
    .map((window) => window.achievement as number);
  return values.length ? Math.min(...values) : null;
}

function trendScore(windows: Record<string, WindowEvidence | null>, configWindows: WindowConfig[]): number | null {
  const signal = configWindows.find((window) => window.role === "SIGNAL");
  const baseline = [...configWindows].reverse().find((window) => window.role === "BASELINE")
    ?? [...configWindows].reverse().find((window) => window.role === "CONFIRMATION");
  const signalScore = signal ? windows[signal.id]?.achievement : null;
  const baselineScore = baseline ? windows[baseline.id]?.achievement : null;
  if (signalScore === null || signalScore === undefined || baselineScore === null || baselineScore === undefined || baselineScore <= 0) return null;
  return signalScore / baselineScore;
}

function redFlagWindows(
  windows: Record<string, WindowEvidence | null>,
  configWindows: WindowConfig[]
): string[] {
  return configWindows.flatMap((window) => {
    const evidence = windows[window.id];
    // A window only raises a flag once it carries evidence of its own. Without
    // this a partial Today window flags nearly every entity before midday.
    return window.redFlagThreshold !== null
      && evidence?.eligible
      && evidence.evidenceCount > 0
      && evidence.achievement !== null
      && evidence.achievement < window.redFlagThreshold
      ? [window.id]
      : [];
  });
}

export function buildEntityEvidence(
  facts: FactRow[],
  config: ProjectConfig,
  definition: MetricDefinition,
  asOfDate: string,
  scope: OptimizationScope
): EntityEvidence[] {
  const configWindows = resolvedWindows(scope.windows);
  const groups = new Map<string, FactRow[]>();
  for (const row of expandFactLevels(facts)) {
    const key = `${row.entityLevel}|${entityId(row)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  const evidence = [...groups.values()].map((rows) => {
    const current = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];
    const windows: Record<string, WindowEvidence | null> = {};
    for (const windowConfig of configWindows) {
      const bounds = windowBounds(windowConfig, asOfDate, config.startDate);
      const selected = rows.filter((row) => row.date >= bounds.start && row.date < bounds.endExclusive);
      const totals = sumFacts(selected);
      const value = selected.length ? computeMetric(totals, definition) : null;
      const evidenceCount = resultEvidence(totals, definition);
      const eligible = selected.length > 0
        && totals.spend >= windowConfig.minSpend
        && evidenceCount >= windowConfig.minResults;
      windows[windowConfig.id] = {
        id: windowConfig.id,
        label: windowConfig.label ?? windowConfig.id,
        role: windowConfig.role,
        includeInScore: windowConfig.includeInScore,
        ...bounds,
        totals,
        value,
        achievement: achievement(value, scope.planTarget, definition.direction),
        rowCount: selected.length,
        evidenceCount,
        eligible
      };
    }
    return {
      scopeId: scope.scopeId,
      scopeName: scope.name,
      entityLevel: current.entityLevel,
      entityId: entityId(current),
      entityName: current.entityName,
      campaignId: current.campaignId,
      adsetId: current.adsetId,
      adId: current.adId,
      status: current.status,
      budgetType: current.budgetType,
      windows,
      weightedAchievement: windowScore(windows, configWindows, scope),
      minimumWindowAchievement: minimumScore(windows, configWindows),
      trendRatio: trendScore(windows, configWindows),
      redFlagWindowIds: redFlagWindows(windows, configWindows),
      projectWeightedAchievement: null,
      cohortWeightedAchievement: null,
      cohortBenchmark: null,
      cohortRank: null,
      cohortSize: null,
      contextAchievement: null,
      blendedAchievement: null
    };
  });

  const aggregateLevel: EntityLevel = evidence.some((item) => item.entityLevel === "CAMPAIGN")
    ? "CAMPAIGN"
    : evidence.some((item) => item.entityLevel === "ADSET")
      ? "ADSET"
      : "AD";
  const projectWindows: Record<string, WindowEvidence | null> = {};
  for (const windowConfig of configWindows) {
    const aggregateWindows = evidence
      .filter((item) => item.entityLevel === aggregateLevel)
      .map((item) => item.windows[windowConfig.id])
      .filter((item): item is WindowEvidence => item !== null);
    if (!aggregateWindows.length) {
      projectWindows[windowConfig.id] = null;
      continue;
    }
    const totals = aggregateWindows.reduce<MetricTotals>(
      (sum, item) => mergeMetricTotals(sum, item.totals),
      { spend: 0, result: null, qualifiedResult: null, revenue: null, impressions: null, clicks: null, metrics: {} }
    );
    const value = computeMetric(totals, definition);
    const evidenceCount = resultEvidence(totals, definition);
    projectWindows[windowConfig.id] = {
      id: windowConfig.id,
      label: windowConfig.label ?? windowConfig.id,
      role: windowConfig.role,
      includeInScore: windowConfig.includeInScore,
      ...windowBounds(windowConfig, asOfDate, config.startDate),
      totals,
      value,
      achievement: achievement(value, scope.planTarget, definition.direction),
      rowCount: aggregateWindows.reduce((sum, item) => sum + item.rowCount, 0),
      evidenceCount,
      eligible: totals.spend >= windowConfig.minSpend && evidenceCount >= windowConfig.minResults
    };
  }
  const projectWeightedAchievement = windowScore(projectWindows, configWindows, scope);
  return evidence.map((item) => ({ ...item, projectWeightedAchievement }));
}

function baseEntityLevel(facts: FactRow[]): EntityLevel {
  if (facts.some((fact) => fact.entityLevel === "AD")) return "AD";
  if (facts.some((fact) => fact.entityLevel === "ADSET")) return "ADSET";
  return "CAMPAIGN";
}

export type CohortModel = {
  /** Benchmark across the whole peer group, used for display and as a fallback. */
  benchmark: number | null;
  /** Peer metric value per entity over the lookback window. */
  entityValues: Map<string, number>;
  /** Benchmark an individual entity is judged against. */
  benchmarkFor: (id: string) => number | null;
  /** 1 = best performer in the peer group. */
  rankFor: (id: string) => number | null;
  size: number;
};

const EMPTY_COHORT: CohortModel = {
  benchmark: null,
  entityValues: new Map(),
  benchmarkFor: () => null,
  rankFor: () => null,
  size: 0
};

export function buildCohortModel(
  facts: FactRow[],
  scope: OptimizationScope,
  definition: MetricDefinition,
  asOfDate: string
): CohortModel {
  const settings = scope.cohortBenchmark;
  if (!settings.enabled) return EMPTY_COHORT;
  if (settings.manualValue) {
    return { ...EMPTY_COHORT, benchmark: settings.manualValue, benchmarkFor: () => settings.manualValue };
  }
  const start = addDays(asOfDate, -settings.lookbackDays + 1);
  const end = addDays(asOfDate, 1);
  const level = baseEntityLevel(facts);
  const selected = facts.filter((fact) => fact.entityLevel === level && fact.date >= start && fact.date < end);
  const aggregate = sumFacts(selected);
  if (resultEvidence(aggregate, definition) < settings.minResults) return EMPTY_COHORT;

  const groups = new Map<string, FactRow[]>();
  for (const fact of selected) {
    const key = entityId(fact);
    const existing = groups.get(key);
    if (existing) existing.push(fact);
    else groups.set(key, [fact]);
  }
  if (groups.size < settings.minEntities) return EMPTY_COHORT;

  const totalsById = new Map([...groups].map(([id, rows]) => [id, sumFacts(rows)]));
  const entityValues = new Map<string, number>();
  for (const [id, totals] of totalsById) {
    const value = computeMetric(totals, definition);
    if (value !== null) entityValues.set(id, value);
  }

  const values = [...entityValues.values()];
  const overall = settings.method === "AGGREGATE" ? computeMetric(aggregate, definition) : median(values);

  // Leave-one-out: an entity is compared to its peers, not to a benchmark it
  // helped set. Without this, a dominant spender is mostly measured against
  // itself and always looks average.
  const benchmarkFor = (id: string): number | null => {
    if (!settings.excludeSelf) return overall;
    if (settings.method === "AGGREGATE") {
      const own = totalsById.get(id);
      if (!own) return overall;
      const peers = [...totalsById].filter(([key]) => key !== id).map(([, totals]) => totals);
      if (!peers.length) return overall;
      const merged = peers.reduce<MetricTotals>((sum, totals) => mergeMetricTotals(sum, totals), {
        spend: 0, result: null, qualifiedResult: null, revenue: null, impressions: null, clicks: null, metrics: {}
      });
      return computeMetric(merged, definition) ?? overall;
    }
    const peerValues = [...entityValues].filter(([key]) => key !== id).map(([, value]) => value);
    return peerValues.length ? median(peerValues) : overall;
  };

  const better = definition.direction === "LOWER_IS_BETTER"
    ? (a: number, b: number) => a - b
    : (a: number, b: number) => b - a;
  const ranking = [...entityValues.entries()].sort((a, b) => better(a[1], b[1])).map(([id]) => id);
  const rankById = new Map(ranking.map((id, index) => [id, index + 1]));

  return {
    benchmark: overall,
    entityValues,
    benchmarkFor,
    rankFor: (id: string) => rankById.get(id) ?? null,
    size: entityValues.size
  };
}

/** Kept for callers that only need the peer-group benchmark. */
export function computeCohortBenchmark(
  facts: FactRow[],
  config: ProjectConfig,
  scope: OptimizationScope,
  definition: MetricDefinition,
  asOfDate: string
): number | null {
  return buildCohortModel(facts, scope, definition, asOfDate).benchmark;
}

export function computeCohortWeightedAchievement(
  entity: EntityEvidence,
  cohortBenchmark: number,
  scope: OptimizationScope,
  definition: MetricDefinition
): number | null {
  const configWindows = resolvedWindows(scope.windows);
  const included = configWindows.filter((window) => window.includeInScore && window.weight > 0);
  return blendWindowScores(
    included.map((window) => {
      const evidence = entity.windows[window.id];
      const achievementValue = evidence?.eligible
        ? achievement(evidence.value, cohortBenchmark, definition.direction)
        : null;
      return {
        value: achievementValue,
        weight: window.weight,
        required: window.required
      };
    }),
    scope.achievementCap,
    scope.windowBlendMethod
  );
}

export function attachCohortEvidence(
  planEvidence: EntityEvidence[],
  cohort: CohortModel,
  scope: OptimizationScope,
  definition: MetricDefinition
): EntityEvidence[] {
  return planEvidence.map((item) => {
    const benchmark = cohort.benchmarkFor(item.entityId);
    return {
      ...item,
      cohortWeightedAchievement: benchmark === null
        ? null
        : computeCohortWeightedAchievement(item, benchmark, scope, definition),
      cohortBenchmark: benchmark,
      cohortRank: cohort.rankFor(item.entityId),
      cohortSize: cohort.size
    };
  });
}

export function contextEvidence(entity: EntityEvidence, all: EntityEvidence[]): EntityEvidence | null {
  if (entity.entityLevel === "CAMPAIGN") return null;
  if (entity.entityLevel === "ADSET") {
    return all.find((item) => item.scopeId === entity.scopeId && item.entityLevel === "CAMPAIGN" && item.entityId === entity.campaignId) ?? null;
  }
  return all.find((item) => item.scopeId === entity.scopeId && item.entityLevel === "ADSET" && item.entityId === entity.adsetId)
    ?? all.find((item) => item.scopeId === entity.scopeId && item.entityLevel === "CAMPAIGN" && item.entityId === entity.campaignId)
    ?? null;
}

/**
 * The aggregate an entity is blended against in the second weighting layer.
 *
 * PROJECT mirrors the reference spreadsheet's "Total" column. PARENT compares a
 * child to the container the buyer actually manages, which keeps a healthy ad
 * from being dragged down by unrelated campaigns.
 */
export function contextAchievementFor(
  entity: EntityEvidence,
  all: EntityEvidence[],
  scope: OptimizationScope
): number | null {
  if (scope.contextSource === "PROJECT") return entity.projectWeightedAchievement;
  return contextEvidence(entity, all)?.weightedAchievement ?? entity.projectWeightedAchievement;
}

export function contextGeometricAchievement(entity: EntityEvidence, all: EntityEvidence[]): number | null {
  return contextEvidence(entity, all)?.weightedAchievement ?? entity.projectWeightedAchievement;
}

/**
 * Second weighting layer: entity score blended with its context score.
 *
 * This is the layer the reference spreadsheet calls "Ads 60% / Total 40%". It
 * was configurable in the UI but never read by the engine, so the setting had
 * no effect until now. With context weight 0 the blend returns the entity score
 * unchanged, so projects that do not want it are unaffected.
 */
export function blendedAchievementFor(
  entity: EntityEvidence,
  all: EntityEvidence[],
  config: ProjectConfig,
  scope: OptimizationScope
): { blended: number | null; context: number | null } {
  const context = contextAchievementFor(entity, all, scope);
  const weights = config.contextWeights[entity.entityLevel];
  if (entity.weightedAchievement === null) return { blended: null, context };
  if (context === null || weights.context <= 0) return { blended: entity.weightedAchievement, context };
  const totalWeight = weights.entity + weights.context;
  if (totalWeight <= 0) return { blended: entity.weightedAchievement, context };
  return {
    blended: (entity.weightedAchievement * weights.entity + context * weights.context) / totalWeight,
    context
  };
}

export function attachContextEvidence(
  evidence: EntityEvidence[],
  config: ProjectConfig,
  scope: OptimizationScope
): EntityEvidence[] {
  return evidence.map((item) => {
    const { blended, context } = blendedAchievementFor(item, evidence, config, scope);
    return { ...item, blendedAchievement: blended, contextAchievement: context };
  });
}
