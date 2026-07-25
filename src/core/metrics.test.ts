import { describe, expect, it } from "vitest";
import { computeMetric, sumFacts } from "./metrics";
import type { FactRow } from "./schemas";

function fact(overrides: Partial<FactRow> = {}): FactRow {
  return {
    projectId: "P1",
    platform: "META",
    accountId: "act_1",
    date: "2026-07-20",
    hour: 0,
    entityLevel: "AD",
    campaignId: "C1",
    adsetId: "AS1",
    adId: "A1",
    entityName: "Ad",
    status: "ACTIVE",
    budgetType: "NONE",
    budget: null,
    spend: 100,
    result: null,
    qualifiedResult: null,
    revenue: null,
    impressions: null,
    clicks: null,
    objective: null,
    optimizationGoal: null,
    learningStatus: null,
    postId: null,
    metrics: {},
    dimensions: {},
    sourceUpdatedAt: "2026-07-20T08:00:00Z",
    sourceRowKey: "row-1",
    ...overrides
  };
}

describe("metric aggregation", () => {
  it("preserves missing data as null instead of manufacturing zero", () => {
    const totals = sumFacts([fact(), fact({ sourceRowKey: "row-2" })]);
    expect(totals.result).toBeNull();
    expect(totals.revenue).toBeNull();
    expect(totals.metrics.linkClicks).toBeUndefined();
  });

  it("sums flexible mapped metrics without mixing missing and zero", () => {
    const totals = sumFacts([
      fact({ metrics: { linkClicks: 10, purchase: null } }),
      fact({ sourceRowKey: "row-2", metrics: { linkClicks: 4, purchase: null } })
    ]);
    expect(totals.metrics.linkClicks).toBe(14);
    expect(totals.metrics.purchase).toBeNull();
  });

  it("supports a custom KPI built from mapped metrics", () => {
    const totals = sumFacts([
      fact({ spend: 300, metrics: { bookedAppointment: 3 } }),
      fact({ spend: 200, sourceRowKey: "row-2", metrics: { bookedAppointment: 2 } })
    ]);
    expect(computeMetric(totals, {
      key: "CPBOOKING",
      label: "Cost per booking",
      kind: "RATIO",
      numerator: "spend",
      denominator: "metrics.bookedAppointment",
      multiplier: 1,
      direction: "LOWER_IS_BETTER",
      nullWhenDenominatorZero: true
    })).toBe(100);
  });
});
