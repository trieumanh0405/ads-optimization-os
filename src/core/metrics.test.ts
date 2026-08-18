import { describe, expect, it } from "vitest";
import { computeMetric, sumFacts, weightedGeometricMean, weightedAverage, median, achievement } from "./metrics";
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

  it("uses a weighted geometric mean so a weak window cannot be hidden by a strong one", () => {
    const score = weightedGeometricMean([
      { value: 0.1, weight: 0.6 },
      { value: 2.35, weight: 0.4 }
    ], 3);
    expect(score).toBeCloseTo(0.3535, 4);
  });

  it("returns no score when a required window has insufficient evidence", () => {
    expect(weightedGeometricMean([
      { value: 1.2, weight: 0.4 },
      { value: null, weight: 0.6, required: true }
    ])).toBeNull();
  });
});

describe("weightedAverage", () => {
  it("calculates basic weighted average", () => {
    const res = weightedAverage([
      { value: 10, weight: 1 },
      { value: 20, weight: 3 },
    ]);
    expect(res).toBe(17.5);
  });

  it("handles null values by filtering them out when not required", () => {
    const res = weightedAverage([
      { value: 10, weight: 1 },
      { value: null, weight: 2, required: false },
    ]);
    expect(res).toBe(10);
  });

  it("returns null when a required item has null value", () => {
    const res = weightedAverage([
      { value: 10, weight: 1 },
      { value: null, weight: 2, required: true },
    ]);
    expect(res).toBeNull();
  });
});

describe("median", () => {

  it("calculates median for odd count array", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("calculates median for even count array", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("returns null for empty array", () => {
    expect(median([])).toBeNull();
  });
});

describe("achievement", () => {
  it("calculates HIGHER_IS_BETTER basic achievement", () => {
    expect(achievement(10, 5, "HIGHER_IS_BETTER")).toBe(2);
  });

  it("calculates LOWER_IS_BETTER basic achievement", () => {
    expect(achievement(10, 20, "LOWER_IS_BETTER")).toBe(2);
  });

  it("treats a zero cost-per-result as missing evidence, not a perfect score", () => {
    expect(achievement(0, 20, "LOWER_IS_BETTER")).toBeNull();
  });

  it("returns null when value is null", () => {
    expect(achievement(null, 10, "HIGHER_IS_BETTER")).toBeNull();
  });

  it("returns null when target is negative or zero", () => {
    expect(achievement(10, -5, "HIGHER_IS_BETTER")).toBeNull();
    expect(achievement(10, 0, "HIGHER_IS_BETTER")).toBeNull();
  });
});
