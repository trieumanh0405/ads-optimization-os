import { describe, expect, it } from "vitest";
import { buildScopeSummary, dayElapsedFraction, projectToday } from "./pacing";
import { createProject } from "@/product/defaults";
import type { FactRow, MetricDefinition, ProjectConfig } from "./schemas";

const AS_OF = "2026-08-18";
const RUN_AT = "2026-08-18T10:58:00+07:00";

const CPL_METRIC: MetricDefinition = {
  key: "CPL", label: "CPL", kind: "RATIO", numerator: "spend", denominator: "result",
  multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true
};

function dayOffset(days: number): string {
  const value = new Date(`${AS_OF}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function fact(date: string, spend: number, result: number, id = "AD1"): FactRow {
  return {
    projectId: "P", platform: "META", accountId: "act_1", date, hour: null,
    entityLevel: "AD", campaignId: "C1", adsetId: "AS1", adId: id,
    entityName: id, status: "ACTIVE", budgetType: "ABO", budget: null,
    spend, result, qualifiedResult: null, revenue: null,
    impressions: 1000, clicks: 100, objective: null, optimizationGoal: null,
    learningStatus: null, postId: null, metrics: {}, dimensions: {},
    sourceUpdatedAt: RUN_AT, sourceRowKey: `P|${date}|AD|${id}`
  };
}

function scaffold(overrides: {
  planTarget: number;
  planTargetResults?: number | null;
  estimateRate?: number | null;
  startDate?: string;
  planEndDate?: string | null;
}) {
  const project = createProject({
    projectName: "Plan", platform: "META", accountId: "act_1",
    timezone: "Asia/Bangkok", currency: "VND", startDate: overrides.startDate ?? "2026-08-01",
    primaryMetricKey: "CPL", optimizationEventLabel: "Lead", target: overrides.planTarget,
    salesModel: "MESSAGING_OFFLINE_CLOSE", trackingConfidence: "MEDIUM", capiStatus: "VERIFIED"
  });
  const config: ProjectConfig = {
    ...project.config,
    startDate: overrides.startDate ?? "2026-08-01",
    planEndDate: overrides.planEndDate ?? null
  };
  const scope = {
    ...project.config.optimizationScopes[0],
    planTarget: overrides.planTarget,
    planTargetResults: overrides.planTargetResults ?? null,
    estimateRate: overrides.estimateRate ?? null
  };
  return { config, scope };
}

describe("estimate rate bridges reported and qualified results", () => {
  // Numbers taken from the team's reference spreadsheet so the tool can be
  // checked against it directly.
  const SHEET_SPEND = 235_246_694;
  const SHEET_REPORTED_RESULTS = 306;
  const SHEET_TARGET_QUALIFIED_COST = 756_860;
  const SHEET_TARGET_QUALIFIED_RESULTS = 402;
  const SHEET_RATE = 0.75;

  const summary = () => {
    const { config, scope } = scaffold({
      planTarget: SHEET_TARGET_QUALIFIED_COST,
      planTargetResults: SHEET_TARGET_QUALIFIED_RESULTS,
      estimateRate: SHEET_RATE
    });
    return buildScopeSummary({
      facts: [fact(AS_OF, SHEET_SPEND, SHEET_REPORTED_RESULTS)],
      config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    });
  };

  it("reproduces the reported result cost", () => {
    expect(summary().actual.costPerReportedResult).toBeCloseTo(768_780, 0);
  });

  it("reproduces the estimated qualified volume and its cost", () => {
    const actual = summary().actual;
    expect(actual.qualifiedResults).toBeCloseTo(229.5, 3);
    expect(actual.costPerQualifiedResult).toBeCloseTo(1_025_040.06, 1);
  });

  it("reproduces the reported-result target implied by the qualified target", () => {
    const plan = summary().plan;
    expect(plan.targetCostPerReportedResult).toBeCloseTo(567_645, 0);
    expect(plan.targetReportedResults).toBeCloseTo(536, 0);
  });

  it("reproduces the plan achievement", () => {
    expect(summary().achievement).toBeCloseTo(0.7384, 3);
  });

  it("falls back to the plain metric when no estimate rate is configured", () => {
    const { config, scope } = scaffold({ planTarget: 2500 });
    const result = buildScopeSummary({
      facts: [fact(AS_OF, 10_000, 5)],
      config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    });
    expect(result.actual.costPerReportedResult).toBe(2000);
    expect(result.actual.costPerQualifiedResult).toBe(2000);
    // No qualification step, so the reported volume carries straight through.
    expect(result.actual.rate).toBeNull();
    expect(result.actual.qualifiedResults).toBe(result.actual.reportedResults);
    expect(result.achievement).toBeCloseTo(1.25, 5);
  });
});

describe("budget pacing answers how much more has to be pushed", () => {
  const facts = Array.from({ length: 10 }, (_, index) => fact(dayOffset(index + 1), 1_000_000, 20));

  it("reports how far through the plan period the account is", () => {
    const { config, scope } = scaffold({
      planTarget: 50_000, planTargetResults: 400,
      startDate: "2026-08-09", planEndDate: "2026-08-28"
    });
    const pacing = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).pacing;
    expect(pacing.totalDays).toBe(20);
    expect(pacing.elapsedDays).toBe(10);
    expect(pacing.remainingDays).toBe(11);
    expect(pacing.timeProgress).toBeCloseTo(0.5, 5);
  });

  it("flags a plan running behind schedule", () => {
    const { config, scope } = scaffold({
      planTarget: 50_000, planTargetResults: 400,
      startDate: "2026-08-09", planEndDate: "2026-08-28"
    });
    const pacing = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).pacing;
    // 200 of 400 results after half the period reads as exactly on pace.
    expect(pacing.resultProgress).toBeCloseTo(0.5, 5);
    expect(pacing.paceIndex).toBeCloseTo(1, 5);
  });

  it("computes the extra daily spend needed to land the plan on time", () => {
    const { config, scope } = scaffold({
      planTarget: 50_000, planTargetResults: 600,
      startDate: "2026-08-09", planEndDate: "2026-08-28"
    });
    const pacing = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).pacing;
    // 200 delivered, 400 still needed across 11 remaining days.
    expect(pacing.qualifiedRemaining).toBe(400);
    expect(pacing.requiredQualifiedPerDay).toBeCloseTo(400 / 11, 5);
    // Achieved cost per result is 10,000,000 spend / 200 results = 50,000.
    expect(pacing.requiredDailySpend).toBeCloseTo((400 / 11) * 50_000, 0);
    expect(pacing.currentDailySpend).toBeCloseTo(1_000_000, 0);
    expect(pacing.additionalDailySpend).toBeCloseTo((400 / 11) * 50_000 - 1_000_000, 0);
    expect(pacing.remainingBudget).toBeCloseTo(400 * 50_000, 0);
  });

  it("reports the cheaper requirement when efficiency reaches the plan target", () => {
    const { config, scope } = scaffold({
      planTarget: 25_000, planTargetResults: 600,
      startDate: "2026-08-09", planEndDate: "2026-08-28"
    });
    const pacing = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).pacing;
    expect(pacing.requiredDailySpendAtPlanEfficiency).toBeCloseTo((400 / 11) * 25_000, 0);
    expect(pacing.requiredDailySpendAtPlanEfficiency as number)
      .toBeLessThan(pacing.requiredDailySpend as number);
  });

  it("leaves pacing empty when the plan has no end date or volume target", () => {
    const { config, scope } = scaffold({ planTarget: 50_000 });
    const pacing = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).pacing;
    expect(pacing.totalDays).toBeNull();
    expect(pacing.paceIndex).toBeNull();
    expect(pacing.requiredDailySpend).toBeNull();
  });

  it("never asks for extra budget once the plan volume is already delivered", () => {
    const { config, scope } = scaffold({
      planTarget: 50_000, planTargetResults: 100,
      startDate: "2026-08-09", planEndDate: "2026-08-28"
    });
    const pacing = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).pacing;
    expect(pacing.qualifiedRemaining).toBe(0);
    expect(pacing.requiredDailySpend).toBe(0);
  });
});

describe("end of day projection", () => {
  it("measures how much of the day has passed in the project timezone", () => {
    expect(dayElapsedFraction("2026-08-18T10:58:00+07:00", "2026-08-18", "Asia/Bangkok"))
      .toBeCloseTo((10 * 60 + 58) / 1440, 5);
  });

  it("treats a run pointed at an earlier date as a closed day", () => {
    expect(dayElapsedFraction("2026-08-18T10:00:00+07:00", "2026-08-17", "Asia/Bangkok")).toBe(1);
  });

  it("extrapolates today once enough of the day has passed", () => {
    const facts = [
      ...Array.from({ length: 7 }, (_, index) => fact(dayOffset(index + 1), 1_000_000, 20)),
      fact(AS_OF, 300_000, 6)
    ];
    const projection = projectToday(facts, CPL_METRIC, AS_OF, "2026-08-18T12:00:00+07:00", "Asia/Bangkok");
    expect(projection.basis).toBe("EXTRAPOLATED");
    expect(projection.resultsSoFar).toBe(6);
    expect(projection.projectedResults).toBeCloseTo(12, 5);
  });

  it("uses the trailing average instead of extrapolating too early in the day", () => {
    const facts = [
      ...Array.from({ length: 7 }, (_, index) => fact(dayOffset(index + 1), 1_000_000, 20)),
      fact(AS_OF, 20_000, 1)
    ];
    const projection = projectToday(facts, CPL_METRIC, AS_OF, "2026-08-18T02:00:00+07:00", "Asia/Bangkok");
    expect(projection.basis).toBe("TRAILING_AVERAGE");
    expect(projection.projectedResults).toBeCloseTo(20, 5);
  });
});

describe("window summary", () => {
  it("reports each configured window with its own cost and achievement", () => {
    const { config, scope } = scaffold({ planTarget: 50_000, estimateRate: 0.5 });
    const facts = Array.from({ length: 8 }, (_, index) => fact(dayOffset(index), 1_000_000, 40));
    const windows = buildScopeSummary({
      facts, config, scope, definition: CPL_METRIC, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
    }).windows;
    const today = windows.find((window) => window.id === "TODAY");
    expect(today?.spend).toBe(1_000_000);
    expect(today?.costPerReportedResult).toBe(25_000);
    // Half of the reported results are expected to qualify, so the qualified
    // cost is double the reported one.
    expect(today?.costPerQualifiedResult).toBe(50_000);
    expect(today?.achievement).toBeCloseTo(1, 5);
  });
});
