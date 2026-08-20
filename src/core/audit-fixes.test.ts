import { describe, expect, it } from "vitest";
import { runOptimizationEngine } from "./engine";
import { computeMetric } from "./metrics";
import { effectivePlanTarget } from "./windows";
import { buildScopeSummary } from "./pacing";
import { buildDefaultRules } from "@/product/defaults";
import type { FactRow, MetricDefinition, OptimizationScope, ProjectConfig } from "./schemas";

const AS_OF = "2026-08-18";
const RUN_AT = "2026-08-18T10:58:00+07:00";

const day = (back: number) => {
  const date = new Date(`${AS_OF}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
};

const win = (id: string, days: number | null, weight: number, extra: Record<string, unknown> = {}) => ({
  id, days, weight, required: false, includeInScore: true,
  role: "CONFIRMATION" as const, minSpend: 0, minResults: 0, redFlagThreshold: null, ...extra
});

const CPL: MetricDefinition = {
  key: "CPL", label: "Cost per like", kind: "RATIO", numerator: "spend", denominator: "result",
  multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true
};

const baseScope: OptimizationScope = {
  scopeId: "s1", name: "Page Like", enabled: true, primaryMetricKey: "CPL",
  optimizationEventLabel: "Page Like", planTarget: 2500, planTargetResults: null, estimateRate: null,
  ruleSetId: "rs1", ruleVersion: 1, windows: [win("D3", 3, 0.5), win("D7", 7, 0.5)],
  achievementCap: 2, scaleMinWindowAchievement: 1, contextScaleMinAchievement: 1,
  windowBlendMethod: "ARITHMETIC", contextSource: "PARENT",
  cohortBenchmark: { enabled: false, lookbackDays: 14, minEntities: 3, minResults: 5, method: "MEDIAN", excludeSelf: true, manualValue: null },
  cohortGuard: { enabled: false, minPlanAchievement: 0.7, minCohortAchievement: 1.2 },
  methodologyVersion: 2, fallbackClassification: "PFM_INCLUDED", levelSettings: {}
};

const baseConfig: ProjectConfig = {
  projectId: "P", projectName: "Panasonic", platform: "META", accountId: "act_1",
  timezone: "Asia/Bangkok", currency: "VND", startDate: "2026-08-01", planEndDate: null,
  primaryMetricKey: "CPL", optimizationEventLabel: "Page Like", target: 2500,
  salesModel: "MESSAGING_OFFLINE_CLOSE", trackingConfidence: "MEDIUM", capiStatus: "VERIFIED",
  ruleSetId: "rs1", ruleVersion: 1, dataFreshnessHours: 72,
  windows: [win("D3", 3, 0.5), win("D7", 7, 0.5)],
  optimizationScopes: [baseScope], classificationRules: [],
  contextWeights: {
    CAMPAIGN: { entity: 1, context: 0 },
    ADSET: { entity: 1, context: 0 },
    AD: { entity: 1, context: 0 }
  },
  maxDailyScalePct: 0.2, maxDailyScaleActions: 3, deferParentScaleWhenChildAction: true,
  dataSource: { kind: "CSV", autoSyncEnabled: false, syncIntervalMinutes: 60, autoRunAfterSync: false }
};

function fact(over: Partial<FactRow> & { date: string; adId: string }): FactRow {
  return {
    projectId: "P", platform: "META", accountId: "act_1", hour: null, entityLevel: "AD",
    campaignId: "c1", adsetId: "as1", entityName: `Ad ${over.adId}`, status: "ACTIVE",
    budgetType: "ABO", budget: null, spend: 0, result: null, qualifiedResult: null, revenue: null,
    impressions: null, clicks: null, objective: null, optimizationGoal: null, learningStatus: null,
    postId: null, metrics: {}, dimensions: {}, sourceUpdatedAt: RUN_AT,
    sourceRowKey: `P|${over.date}|AD|${over.adId}`, ...over
  } as FactRow;
}

function run(config: ProjectConfig, facts: FactRow[], rules = buildDefaultRules("CPL", "rs1", config.windows)) {
  return runOptimizationEngine({
    asOfDate: AS_OF, runAt: RUN_AT, config, metricDefinitions: [CPL], rules, facts, priorActions: []
  });
}

describe("evidence is not counted twice across nested windows", () => {
  it("reads the widest window instead of summing windows that contain each other", () => {
    // One row of 3.000đ two days ago. The turn-off rule needs 2x target (5.000đ)
    // of spend before it will act, so this entity must stay pending.
    const facts = [fact({ date: day(2), adId: "a1", spend: 3000, result: 0.6 })];
    const single = run({ ...baseConfig, windows: [win("D3", 3, 1)], optimizationScopes: [{ ...baseScope, windows: [win("D3", 3, 1)] }] }, facts);
    const nested = run(baseConfig, facts);

    const decisionOf = (output: ReturnType<typeof run>) =>
      output.recommendations.find((item) => item.entityLevel === "AD")?.recommendedAction;

    expect(decisionOf(single)).toBe("PENDING_DATA");
    // Same money, same results, only the window list differs. Adding D3 and D7
    // used to read 6.000đ and clear the bar, turning off a live ad on air.
    expect(decisionOf(nested)).toBe("PENDING_DATA");
  });
});

describe("estimate rate", () => {
  it("leaves a target that is already stated per qualified result alone", () => {
    const cpql: MetricDefinition = { ...CPL, key: "CPQL", denominator: "qualifiedResult" };
    expect(effectivePlanTarget({ ...baseScope, estimateRate: 0.5 }, cpql)).toBe(2500);
  });

  it("converts a target measured in reported results, the same way in both directions", () => {
    expect(effectivePlanTarget({ ...baseScope, estimateRate: 0.75 }, CPL)).toBe(1875);
    const higher: MetricDefinition = { ...CPL, direction: "HIGHER_IS_BETTER" };
    expect(effectivePlanTarget({ ...baseScope, estimateRate: 0.75 }, higher)).toBe(1875);
  });

  it("puts the evidence bar on the same scale as the score", () => {
    // With a 50% estimate rate the target is 1.250đ, so the 2x spend gate is
    // 2.500đ. It used to stay at 5.000đ and hold back every decision.
    const facts = Array.from({ length: 6 }, (_, index) =>
      fact({ date: day(index), adId: "a1", spend: 600, result: 0.2 }));
    const scope = { ...baseScope, estimateRate: 0.5, windows: [win("D7", 7, 1)] };
    const output = run({ ...baseConfig, windows: [win("D7", 7, 1)], optimizationScopes: [scope] }, facts);
    const ad = output.recommendations.find((item) => item.entityLevel === "AD");
    expect(ad?.targetMetric).toBe(1250);
    expect(ad?.recommendedAction).not.toBe("PENDING_DATA");
  });
});

describe("a zero denominator is unknown, not zero", () => {
  it("refuses to report a cost per result when there are no results", () => {
    expect(computeMetric(
      { spend: 500_000, result: 0, qualifiedResult: null, revenue: null, impressions: null, clicks: null, metrics: {} },
      { ...CPL, nullWhenDenominatorZero: false }
    )).toBeNull();
  });
});

describe("a metric denominated in spend can be scored", () => {
  it("treats spend as the sample for ROAS instead of looking for a result count", () => {
    const roas: MetricDefinition = {
      key: "ROAS", label: "ROAS", kind: "RATIO", numerator: "revenue", denominator: "spend",
      multiplier: 1, direction: "HIGHER_IS_BETTER", nullWhenDenominatorZero: true
    };
    const scope = { ...baseScope, primaryMetricKey: "ROAS", planTarget: 3, windows: [win("D7", 7, 1, { minResults: 1 })] };
    const output = runOptimizationEngine({
      asOfDate: AS_OF, runAt: RUN_AT,
      config: { ...baseConfig, primaryMetricKey: "ROAS", target: 3, windows: scope.windows, optimizationScopes: [scope] },
      metricDefinitions: [roas], rules: buildDefaultRules("ROAS", "rs1", scope.windows),
      facts: [fact({ date: day(1), adId: "a1", spend: 1000, revenue: 5000 })],
      priorActions: []
    });
    const ad = output.evidence.find((item) => item.entityLevel === "AD");
    expect(ad?.windows.D7?.eligible).toBe(true);
    expect(ad?.weightedAchievement).not.toBeNull();
  });
});

describe("plan pacing keeps one calendar", () => {
  const summary = (planEndDate: string, startDate = "2026-08-01") => buildScopeSummary({
    facts: [fact({ date: day(1), adId: "a1", spend: 1000, result: 1 })],
    config: { ...baseConfig, startDate, planEndDate },
    scope: { ...baseScope, planTargetResults: 100 },
    definition: CPL, asOfDate: AS_OF, runAt: RUN_AT, entityCount: 1
  }).pacing;

  it("never counts the day in progress as both elapsed and remaining", () => {
    const pacing = summary("2026-08-31");
    expect((pacing.elapsedDays ?? 0) + (pacing.remainingDays ?? 0)).toBe(pacing.totalDays);
  });

  it("cannot report more days remaining than the plan has", () => {
    const pacing = summary("2026-09-30", "2026-09-01");
    expect(pacing.remainingDays as number).toBeLessThanOrEqual(pacing.totalDays as number);
  });
});

describe("guardrails cover every level", () => {
  it("holds a campaign's budget increase when an ad set inside it is being turned off", () => {
    const facts = [
      // A strong ad set carries the campaign; a weak one has to go.
      ...Array.from({ length: 8 }, (_, index) => fact({ date: day(index), adId: "good", adsetId: "as-good", spend: 800, result: 1 })),
      ...Array.from({ length: 8 }, (_, index) => fact({ date: day(index), adId: "bad", adsetId: "as-bad", spend: 20_000, result: 1 }))
    ];
    const output = run({ ...baseConfig, optimizationScopes: [{ ...baseScope }] }, facts);
    const adsetOff = output.recommendations.some(
      (item) => item.entityLevel === "ADSET" && item.recommendedAction === "TURN_OFF"
    );
    const campaign = output.recommendations.find((item) => item.entityLevel === "CAMPAIGN");
    expect(adsetOff).toBe(true);
    expect(campaign?.recommendedAction).not.toBe("INCREASE_BUDGET");
  });
});

describe("a rule naming a window the level does not have", () => {
  it("declines to decide instead of crashing the whole run", () => {
    const scope: OptimizationScope = {
      ...baseScope,
      windows: [win("D3", 3, 1)],
      levelSettings: { ADSET: { windows: [win("D10", 10, 1)], contextWeights: null, windowBlendMethod: null, contextSource: null } }
    };
    const config = { ...baseConfig, windows: [win("D3", 3, 1)], optimizationScopes: [scope] };
    const output = run(config, [fact({ date: day(1), adId: "a1", spend: 4000, result: 2 })]);
    expect(output.status).toBe("COMPLETED");
    expect(output.recommendations.length).toBeGreaterThan(0);
  });
});

describe("QC checks the weights every level really runs on", () => {
  it("fails a level whose own windows do not add up to 100%", () => {
    const scope: OptimizationScope = {
      ...baseScope,
      windows: [win("D3", 3, 1)],
      levelSettings: { AD: { windows: [win("D3", 3, 0.4)], contextWeights: null, windowBlendMethod: null, contextSource: null } }
    };
    const output = run(
      { ...baseConfig, windows: [win("D3", 3, 1)], optimizationScopes: [scope] },
      [fact({ date: day(1), adId: "a1", spend: 4000, result: 2 })]
    );
    expect(output.qc.issues.some((issue) => issue.code.startsWith("WINDOW_WEIGHTS_NOT_100"))).toBe(true);
  });
});
