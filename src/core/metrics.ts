import type { FactRow, MetricDefinition } from "./schemas";

export type MetricTotals = Pick<FactRow, "spend" | "result" | "qualifiedResult" | "revenue" | "impressions" | "clicks">;

const zeroTotals = (): MetricTotals => ({
  spend: 0, result: 0, qualifiedResult: 0, revenue: 0, impressions: 0, clicks: 0
});

export function sumFacts(facts: FactRow[]): MetricTotals {
  return facts.reduce((total, row) => ({
    spend: total.spend + row.spend,
    result: (total.result ?? 0) + (row.result ?? 0),
    qualifiedResult: (total.qualifiedResult ?? 0) + (row.qualifiedResult ?? 0),
    revenue: (total.revenue ?? 0) + (row.revenue ?? 0),
    impressions: (total.impressions ?? 0) + (row.impressions ?? 0),
    clicks: (total.clicks ?? 0) + (row.clicks ?? 0)
  }), zeroTotals());
}

export function computeMetric(totals: MetricTotals, definition: MetricDefinition): number | null {
  const numerator = totals[definition.numerator];
  if (numerator === null) return null;
  if (definition.kind === "SUM") return numerator;
  if (!definition.denominator) return null;
  const denominator = totals[definition.denominator];
  if (denominator === null || denominator === 0) return definition.nullWhenDenominatorZero ? null : 0;
  return (numerator / denominator) * definition.multiplier;
}

export function achievement(value: number | null, target: number, direction: MetricDefinition["direction"]): number | null {
  if (value === null || value < 0 || target <= 0) return null;
  if (direction === "LOWER_IS_BETTER") return value === 0 ? null : target / value;
  return value / target;
}

export function weightedAverage(items: Array<{ value: number | null; weight: number; required?: boolean }>): number | null {
  if (items.some((item) => item.required && item.value === null)) return null;
  const available = items.filter((item): item is { value: number; weight: number; required?: boolean } => item.value !== null && item.weight > 0);
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  if (!available.length || totalWeight <= 0) return null;
  return available.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}
