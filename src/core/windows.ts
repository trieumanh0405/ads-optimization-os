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
};

export function expandFactLevels(facts: FactRow[]): FactRow[] {
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

function geometricScore(windows: Record<string, WindowEvidence | null>, configWindows: WindowConfig[], cap: number): number | null {
  const included = configWindows.filter((window) => window.includeInScore && window.weight > 0);
  return weightedGeometricMean(included.map((window) => {
    const evidence = windows[window.id];
    return {
      value: evidence?.eligible ? evidence.achievement : null,
      weight: window.weight,
      required: window.required
    };
  }), cap);
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
    return window.redFlagThreshold !== null
      && evidence?.eligible
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
    groups.set(key, [...(groups.get(key) ?? []), row]);
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
      weightedAchievement: geometricScore(windows, configWindows, scope.achievementCap),
      minimumWindowAchievement: minimumScore(windows, configWindows),
      trendRatio: trendScore(windows, configWindows),
      redFlagWindowIds: redFlagWindows(windows, configWindows),
      projectWeightedAchievement: null,
      cohortWeightedAchievement: null,
      cohortBenchmark: null
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
  const projectWeightedAchievement = geometricScore(projectWindows, configWindows, scope.achievementCap);
  return evidence.map((item) => ({ ...item, projectWeightedAchievement }));
}

function baseEntityLevel(facts: FactRow[]): EntityLevel {
  if (facts.some((fact) => fact.entityLevel === "AD")) return "AD";
  if (facts.some((fact) => fact.entityLevel === "ADSET")) return "ADSET";
  return "CAMPAIGN";
}

export function computeCohortBenchmark(
  facts: FactRow[],
  config: ProjectConfig,
  scope: OptimizationScope,
  definition: MetricDefinition,
  asOfDate: string
): number | null {
  if (!scope.cohortBenchmark.enabled) return null;
  if (scope.cohortBenchmark.manualValue) return scope.cohortBenchmark.manualValue;
  const start = addDays(asOfDate, -scope.cohortBenchmark.lookbackDays + 1);
  const end = addDays(asOfDate, 1);
  const level = baseEntityLevel(facts);
  const selected = facts.filter((fact) => fact.entityLevel === level && fact.date >= start && fact.date < end);
  const aggregate = sumFacts(selected);
  if (resultEvidence(aggregate, definition) < scope.cohortBenchmark.minResults) return null;
  const ids = new Set(selected.map(entityId));
  if (ids.size < scope.cohortBenchmark.minEntities) return null;
  if (scope.cohortBenchmark.method === "AGGREGATE") return computeMetric(aggregate, definition);
  const groups = new Map<string, FactRow[]>();
  for (const fact of selected) groups.set(entityId(fact), [...(groups.get(entityId(fact)) ?? []), fact]);
  return median([...groups.values()]
    .map((rows) => computeMetric(sumFacts(rows), definition))
    .filter((value): value is number => value !== null));
}

export function attachCohortEvidence(
  planEvidence: EntityEvidence[],
  cohortEvidence: EntityEvidence[],
  benchmark: number | null
): EntityEvidence[] {
  const scores = new Map(cohortEvidence.map((item) => [`${item.entityLevel}|${item.entityId}`, item.weightedAchievement]));
  return planEvidence.map((item) => ({
    ...item,
    cohortWeightedAchievement: scores.get(`${item.entityLevel}|${item.entityId}`) ?? null,
    cohortBenchmark: benchmark
  }));
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

export function contextGeometricAchievement(entity: EntityEvidence, all: EntityEvidence[]): number | null {
  return contextEvidence(entity, all)?.weightedAchievement ?? entity.projectWeightedAchievement;
}
