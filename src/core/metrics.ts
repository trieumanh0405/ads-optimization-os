import type { FactRow, MetricDefinition } from "./schemas";

export type MetricTotals = Pick<FactRow, "spend" | "result" | "qualifiedResult" | "revenue" | "impressions" | "clicks">
  & { metrics: Record<string, number | null> };

const zeroTotals = (): MetricTotals => ({
  spend: 0, result: null, qualifiedResult: null, revenue: null, impressions: null, clicks: null, metrics: {}
});

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

export function mergeMetricTotals(left: MetricTotals, right: MetricTotals): MetricTotals {
  const keys = new Set([...Object.keys(left.metrics), ...Object.keys(right.metrics)]);
  return {
    spend: left.spend + right.spend,
    result: addNullable(left.result, right.result),
    qualifiedResult: addNullable(left.qualifiedResult, right.qualifiedResult),
    revenue: addNullable(left.revenue, right.revenue),
    impressions: addNullable(left.impressions, right.impressions),
    clicks: addNullable(left.clicks, right.clicks),
    metrics: Object.fromEntries([...keys].map((key) => [
      key,
      addNullable(left.metrics[key] ?? null, right.metrics[key] ?? null)
    ]))
  };
}

export function sumFacts(facts: FactRow[]): MetricTotals {
  return facts.reduce((total, row) => mergeMetricTotals(total, {
    spend: row.spend,
    result: row.result,
    qualifiedResult: row.qualifiedResult,
    revenue: row.revenue,
    impressions: row.impressions,
    clicks: row.clicks,
    metrics: row.metrics
  }), zeroTotals());
}

function metricOperand(totals: MetricTotals, operand: MetricDefinition["numerator"]): number | null {
  if (operand.startsWith("metrics.")) return totals.metrics[operand.slice("metrics.".length)] ?? null;
  return totals[operand as keyof Pick<MetricTotals, "spend" | "result" | "qualifiedResult" | "revenue" | "impressions" | "clicks">];
}

export function computeMetric(totals: MetricTotals, definition: MetricDefinition): number | null {
  const numerator = metricOperand(totals, definition.numerator);
  if (numerator === null) return null;
  if (definition.kind === "SUM") return numerator;
  if (!definition.denominator) return null;
  const denominator = metricOperand(totals, definition.denominator);
  if (denominator === null || denominator === 0) return definition.nullWhenDenominatorZero ? null : 0;
  return (numerator / denominator) * definition.multiplier;
}

/**
 * Achievement is always expressed as "higher is better".
 *
 * A cost-per-result of exactly zero is a data artefact, not a perfect result:
 * it only happens when a period recorded results with no recorded spend, which
 * is common while a sheet sync lags. Returning a capped "perfect" score there
 * let a genuinely weak entity be rescued by one broken row, so this returns
 * null instead and the period is treated as missing evidence.
 */
export function achievement(value: number | null, target: number, direction: MetricDefinition["direction"]): number | null {
  if (value === null || value < 0 || target <= 0) return null;
  if (direction === "LOWER_IS_BETTER") return value === 0 ? null : target / value;
  return value / target;
}

export function weightedAverage(
  items: Array<{ value: number | null; weight: number; required?: boolean }>,
  cap?: number
): number | null {
  if (items.some((item) => item.required && item.value === null)) return null;
  const available = items.filter((item): item is { value: number; weight: number; required?: boolean } => item.value !== null && item.weight > 0);
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  if (!available.length || totalWeight <= 0) return null;
  return available.reduce(
    (sum, item) => sum + (cap === undefined ? item.value : Math.min(item.value, cap)) * item.weight,
    0
  ) / totalWeight;
}

/**
 * Weighted geometric mean used for stability across time windows.
 * A zero achievement with sufficient evidence is a real red flag and therefore
 * collapses the score to zero. Optional missing values are ignored and the
 * remaining weights are normalized. Values are capped for scoring only so one
 * exceptional window cannot hide a weak window.
 */
export function weightedGeometricMean(
  items: Array<{ value: number | null; weight: number; required?: boolean }>,
  cap = 2
): number | null {
  if (items.some((item) => item.required && item.value === null)) return null;
  const available = items.filter((item): item is { value: number; weight: number; required?: boolean } =>
    item.value !== null && item.value >= 0 && item.weight > 0
  );
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  if (!available.length || totalWeight <= 0) return null;
  if (available.some((item) => item.value === 0)) return 0;
  const logScore = available.reduce((sum, item) =>
    sum + (item.weight / totalWeight) * Math.log(Math.min(item.value, cap)), 0
  );
  return Math.exp(logScore);
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
