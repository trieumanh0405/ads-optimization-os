import type { EntityLevel, FactRow, MetricDefinition, ProjectConfig } from "./schemas";
import { achievement, computeMetric, sumFacts, weightedAverage, type MetricTotals } from "./metrics";

export type WindowId = "TODAY" | "SHORT" | "LONG" | "LIFETIME";
export type WindowEvidence = { id: WindowId; start: string; endExclusive: string; totals: MetricTotals; value: number | null; achievement: number | null; rowCount: number };
export type EntityEvidence = {
  entityLevel: EntityLevel; entityId: string; entityName: string; campaignId: string;
  adsetId: string | null; adId: string | null; status: string; budgetType: FactRow["budgetType"];
  windows: Record<WindowId, WindowEvidence | null>; weightedAchievement: number | null;
  projectWeightedAchievement: number | null;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function entityId(row: FactRow): string {
  if (row.entityLevel === "CAMPAIGN") return row.campaignId;
  if (row.entityLevel === "ADSET") return row.adsetId ?? "";
  return row.adId ?? "";
}

export function windowBounds(id: WindowId, asOfDate: string, days: number | null, projectStartDate: string) {
  if (id === "TODAY") return { start: asOfDate, endExclusive: addDays(asOfDate, 1) };
  if (id === "LIFETIME") return { start: projectStartDate, endExclusive: addDays(asOfDate, 1) };
  if (!days) throw new Error(`${id} requires a positive day count`);
  return { start: addDays(asOfDate, -days), endExclusive: asOfDate };
}

export function buildEntityEvidence(facts: FactRow[], config: ProjectConfig, definition: MetricDefinition, asOfDate: string): EntityEvidence[] {
  const groups = new Map<string, FactRow[]>();
  for (const row of facts) {
    const key = `${row.entityLevel}|${entityId(row)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const evidence = [...groups.values()].map((rows) => {
    const current = rows.sort((a, b) => b.date.localeCompare(a.date))[0];
    const windows = { TODAY: null, SHORT: null, LONG: null, LIFETIME: null } as Record<WindowId, WindowEvidence | null>;
    for (const windowConfig of config.windows) {
      const bounds = windowBounds(windowConfig.id, asOfDate, windowConfig.days, config.startDate);
      const selected = rows.filter((row) => row.date >= bounds.start && row.date < bounds.endExclusive);
      const totals = sumFacts(selected);
      const value = selected.length ? computeMetric(totals, definition) : null;
      windows[windowConfig.id] = { id: windowConfig.id, ...bounds, totals, value, achievement: achievement(value, config.target, definition.direction), rowCount: selected.length };
    }
    const weightedAchievement = weightedAverage(config.windows.map((item) => ({ value: windows[item.id]?.achievement ?? null, weight: item.weight, required: item.required })));
    return {
      entityLevel: current.entityLevel, entityId: entityId(current), entityName: current.entityName,
      campaignId: current.campaignId, adsetId: current.adsetId, adId: current.adId,
      status: current.status, budgetType: current.budgetType, windows, weightedAchievement,
      projectWeightedAchievement: null
    };
  });
  const projectWindowAchievements = new Map<WindowId, number | null>();
  for (const windowConfig of config.windows) {
    const campaignWindows = evidence.filter((item) => item.entityLevel === "CAMPAIGN").map((item) => item.windows[windowConfig.id]).filter((item): item is WindowEvidence => item !== null);
    if (!campaignWindows.length) {
      projectWindowAchievements.set(windowConfig.id, null);
      continue;
    }
    const totals = campaignWindows.reduce<MetricTotals>((sum, item) => ({
      spend: sum.spend + item.totals.spend,
      result: (sum.result ?? 0) + (item.totals.result ?? 0),
      qualifiedResult: (sum.qualifiedResult ?? 0) + (item.totals.qualifiedResult ?? 0),
      revenue: (sum.revenue ?? 0) + (item.totals.revenue ?? 0),
      impressions: (sum.impressions ?? 0) + (item.totals.impressions ?? 0),
      clicks: (sum.clicks ?? 0) + (item.totals.clicks ?? 0)
    }), { spend: 0, result: 0, qualifiedResult: 0, revenue: 0, impressions: 0, clicks: 0 });
    projectWindowAchievements.set(windowConfig.id, achievement(computeMetric(totals, definition), config.target, definition.direction));
  }
  const projectWeightedAchievement = weightedAverage(config.windows.map((item) => ({
    value: projectWindowAchievements.get(item.id) ?? null, weight: item.weight, required: item.required
  })));
  return evidence.map((item) => ({ ...item, projectWeightedAchievement }));
}

export function contextEvidence(entity: EntityEvidence, all: EntityEvidence[]): EntityEvidence | null {
  if (entity.entityLevel === "CAMPAIGN") return null;
  if (entity.entityLevel === "ADSET") return all.find((item) => item.entityLevel === "CAMPAIGN" && item.entityId === entity.campaignId) ?? null;
  return all.find((item) => item.entityLevel === "ADSET" && item.entityId === entity.adsetId)
    ?? all.find((item) => item.entityLevel === "CAMPAIGN" && item.entityId === entity.campaignId) ?? null;
}

export function contextWeightedAchievement(entity: EntityEvidence, all: EntityEvidence[], config: ProjectConfig): number | null {
  const weights = config.contextWeights[entity.entityLevel];
  const context = contextEvidence(entity, all);
  const contextScore = context?.weightedAchievement ?? entity.projectWeightedAchievement;
  return weightedAverage([
    { value: entity.weightedAchievement, weight: weights.entity, required: true },
    { value: contextScore, weight: weights.context, required: weights.context > 0 }
  ]);
}
