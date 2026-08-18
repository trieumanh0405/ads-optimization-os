import { describe, expect, it } from "vitest";
import { runOptimizationEngine } from "./engine";
import { createProject } from "@/product/defaults";
import { blendWindowScores, buildCohortModel } from "./windows";
import { upgradeScope } from "./scopes";
import type { FactRow, MetricDefinition, OptimizationScope } from "./schemas";

const AS_OF = "2026-08-18";
const RUN_AT = "2026-08-18T10:00:00+07:00";
const TARGET = 2500;

const CPL_METRIC: MetricDefinition = {
  key: "CPL", label: "CPL", kind: "RATIO", numerator: "spend", denominator: "result",
  multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true
};

function dayOffset(days: number): string {
  const value = new Date(`${AS_OF}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function baseProject() {
  return createProject({
    projectName: "Methodology", platform: "META", accountId: "act_1",
    timezone: "Asia/Bangkok", currency: "VND", startDate: "2026-08-01",
    primaryMetricKey: "CPL", optimizationEventLabel: "Lead", target: TARGET,
    salesModel: "MESSAGING_OFFLINE_CLOSE", trackingConfidence: "MEDIUM", capiStatus: "VERIFIED"
  });
}

function adFacts(specs: Array<{ id: string; cpl: number; adsetId?: string; days?: number }>): FactRow[] {
  return specs.flatMap((spec) => {
    const days = spec.days ?? 14;
    return Array.from({ length: days }, (_, index) => {
      const date = dayOffset(index);
      return {
        projectId: "P", platform: "META", accountId: "act_1", date, hour: null,
        entityLevel: "AD" as const, campaignId: "C1", adsetId: spec.adsetId ?? "AS1", adId: spec.id,
        entityName: spec.id, status: "ACTIVE", budgetType: "ABO" as const, budget: null,
        spend: spec.cpl * 4, result: 4, qualifiedResult: null, revenue: null,
        impressions: 10000, clicks: 200, objective: null, optimizationGoal: null,
        learningStatus: null, postId: null, metrics: {}, dimensions: {},
        sourceUpdatedAt: RUN_AT, sourceRowKey: `P|${date}|AD|${spec.id}`
      };
    });
  });
}

function run(project: ReturnType<typeof baseProject>, facts: FactRow[]) {
  return runOptimizationEngine({
    asOfDate: AS_OF, runAt: RUN_AT,
    config: { ...project.config, projectId: "P", accountId: "act_1", dataFreshnessHours: 48 },
    metricDefinitions: project.metricDefinitions,
    rules: project.rules,
    facts, priorActions: []
  });
}

function adDecision(output: ReturnType<typeof runOptimizationEngine>, adId: string) {
  return output.recommendations.find((item) => item.entityLevel === "AD" && item.entityId === adId);
}

/** A fleet whose overall performance sits well below the plan target. */
const UNDERPERFORMING_FLEET = adFacts([
  { id: "GOOD", cpl: 1500 },
  { id: "NEAR", cpl: 2600 },
  { id: "WEAK", cpl: 4800 },
  { id: "BAD", cpl: 9000 },
  { id: "WORST", cpl: 15000 }
]);

describe("decision bands follow the reference spreadsheet", () => {
  it("keeps an ad sitting between 80% and 100% of target instead of turning it off", () => {
    const project = baseProject();
    // 2600d against a 2500d target is a 96% achievement: under plan, but inside
    // the Keep band of the reference spreadsheet.
    const output = run(project, adFacts([{ id: "NEAR", cpl: 2600 }, { id: "GOOD", cpl: 1500 }, { id: "OK", cpl: 2400 }]));
    const near = adDecision(output, "NEAR");
    expect(near?.recommendedAction).toBe("KEEP");
  });

  it("turns off an ad below 80% of target", () => {
    const project = baseProject();
    const output = run(project, UNDERPERFORMING_FLEET);
    expect(adDecision(output, "WORST")?.recommendedAction).toBe("TURN_OFF");
    expect(adDecision(output, "BAD")?.recommendedAction).toBe("TURN_OFF");
  });

  it("lowers ad set budget rather than keeping it flat in the 80-100% band", () => {
    const rule = baseProject().rules.find((item) => item.id === "adset-watch");
    expect(rule?.actionCode).toBe("DECREASE_BUDGET");
    expect(rule?.actionValue).toBe(-0.15);
  });

  it("describes every band with the threshold it actually uses", () => {
    const rules = baseProject().rules.filter((item) => item.entityLevel === "AD");
    expect(rules.find((item) => item.id === "ad-critical-under-target")?.description).toContain("80%");
    expect(rules.find((item) => item.id === "ad-watch")?.description).toContain("80%");
    expect(rules.find((item) => item.id === "ad-keep")?.description).toContain("100%");
    expect(rules.find((item) => item.id === "ad-scale")?.description).toContain("120%");
  });
});

describe("cohort comparison informs but does not veto", () => {
  it("still turns off a weak ad in an account that performs below plan overall", () => {
    const project = baseProject();
    const output = run(project, UNDERPERFORMING_FLEET);
    const weak = adDecision(output, "WEAK");
    expect(weak?.recommendedAction).toBe("TURN_OFF");
    expect(weak?.reasonCodes).not.toContain("BELOW_PLAN_BUT_COMPETITIVE_WITH_COHORT");
  });

  it("defers to manual review only when the opt-in guard is switched on", () => {
    const project = baseProject();
    project.config.optimizationScopes = project.config.optimizationScopes.map((scope) => ({
      ...scope,
      cohortGuard: { enabled: true, minPlanAchievement: 0.4, minCohortAchievement: 1.05 }
    }));
    const output = run(project, UNDERPERFORMING_FLEET);
    const weak = adDecision(output, "WEAK");
    expect(weak?.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(weak?.reasonCodes).toContain("BELOW_PLAN_BUT_COMPETITIVE_WITH_COHORT");
  });

  it("never rescues an entity that falls below the guard's plan floor", () => {
    const project = baseProject();
    project.config.optimizationScopes = project.config.optimizationScopes.map((scope) => ({
      ...scope,
      cohortGuard: { enabled: true, minPlanAchievement: 0.7, minCohortAchievement: 1.05 }
    }));
    const output = run(project, UNDERPERFORMING_FLEET);
    // WEAK sits at roughly 52% of plan, below the 70% floor, so the guard
    // cannot apply no matter how it compares to its peers.
    expect(adDecision(output, "WEAK")?.recommendedAction).toBe("TURN_OFF");
  });

  it("reports the peer rank so the cohort column separates entities", () => {
    const project = baseProject();
    const output = run(project, UNDERPERFORMING_FLEET);
    expect(adDecision(output, "GOOD")?.cohortRank).toBe(1);
    expect(adDecision(output, "WORST")?.cohortRank).toBe(5);
    expect(adDecision(output, "GOOD")?.cohortSize).toBe(5);
  });
});

describe("cohort benchmark maths", () => {
  const scope = (overrides: Partial<OptimizationScope["cohortBenchmark"]>): OptimizationScope => ({
    ...baseProject().config.optimizationScopes[0],
    cohortBenchmark: {
      enabled: true, lookbackDays: 14, minEntities: 3, minResults: 5,
      method: "MEDIAN", excludeSelf: true, manualValue: null, ...overrides
    }
  });

  it("excludes an entity from the benchmark it is judged against", () => {
    const facts = adFacts([
      { id: "A", cpl: 1000 }, { id: "B", cpl: 2000 },
      { id: "C", cpl: 3000 }, { id: "D", cpl: 4000 }
    ]);
    const model = buildCohortModel(facts, scope({}), CPL_METRIC, AS_OF);
    // Median of all four is 2500; leaving A out shifts the peer median up.
    expect(model.benchmark).toBe(2500);
    expect(model.benchmarkFor("A")).toBe(3000);
    expect(model.benchmarkFor("D")).toBe(2000);
  });

  it("keeps the shared benchmark when leave-one-out is switched off", () => {
    const facts = adFacts([{ id: "A", cpl: 1000 }, { id: "B", cpl: 2000 }, { id: "C", cpl: 3000 }]);
    const model = buildCohortModel(facts, scope({ excludeSelf: false }), CPL_METRIC, AS_OF);
    expect(model.benchmarkFor("A")).toBe(model.benchmark);
  });

  it("resists a dominant spender when using the median", () => {
    const facts = [
      ...adFacts([{ id: "A", cpl: 1000 }, { id: "B", cpl: 1100 }, { id: "C", cpl: 1200 }]),
      // One entity spending far more than the rest at a terrible rate.
      ...Array.from({ length: 14 }, (_, index) => ({
        projectId: "P", platform: "META", accountId: "act_1", date: dayOffset(index), hour: null,
        entityLevel: "AD" as const, campaignId: "C1", adsetId: "AS1", adId: "WHALE",
        entityName: "WHALE", status: "ACTIVE", budgetType: "ABO" as const, budget: null,
        spend: 900000, result: 4, qualifiedResult: null, revenue: null,
        impressions: 10000, clicks: 200, objective: null, optimizationGoal: null,
        learningStatus: null, postId: null, metrics: {}, dimensions: {},
        sourceUpdatedAt: RUN_AT, sourceRowKey: `P|${dayOffset(index)}|AD|WHALE`
      }))
    ];
    const medianModel = buildCohortModel(facts, scope({ excludeSelf: false }), CPL_METRIC, AS_OF);
    const aggregateModel = buildCohortModel(facts, scope({ method: "AGGREGATE", excludeSelf: false }), CPL_METRIC, AS_OF);
    expect(medianModel.benchmark).toBeLessThan(2000);
    expect(aggregateModel.benchmark).toBeGreaterThan(50000);
  });
});

describe("window blending", () => {
  const windows = [
    { value: 1.2, weight: 0.6, required: false },
    { value: 0.4, weight: 0.4, required: false }
  ];

  it("matches the spreadsheet when using the arithmetic blend", () => {
    expect(blendWindowScores(windows, 2, "ARITHMETIC")).toBeCloseTo(0.88, 5);
  });

  it("punishes the weak window harder when using the geometric blend", () => {
    const geometric = blendWindowScores(windows, 2, "GEOMETRIC");
    expect(geometric).not.toBeNull();
    expect(geometric as number).toBeLessThan(0.8);
  });

  it("caps an exceptional window so it cannot mask a weak one", () => {
    const blended = blendWindowScores(
      [{ value: 10, weight: 0.6, required: false }, { value: 0.1, weight: 0.4, required: false }],
      2,
      "ARITHMETIC"
    );
    expect(blended).toBeCloseTo(1.24, 5);
  });
});

describe("second weighting layer", () => {
  it("blends the entity score with its context using the configured weights", () => {
    const project = baseProject();
    const output = run(project, UNDERPERFORMING_FLEET);
    const good = adDecision(output, "GOOD");
    expect(good?.weightedAchievement).not.toBeNull();
    expect(good?.contextWeightedAchievement).not.toBeNull();
    const expected = (good!.weightedAchievement as number) * 0.6 + (good!.contextWeightedAchievement as number) * 0.4;
    expect(good?.blendedAchievement).toBeCloseTo(expected, 6);
  });

  it("leaves the entity score untouched when context weight is zero", () => {
    const project = baseProject();
    project.config.contextWeights = {
      CAMPAIGN: { entity: 1, context: 0 },
      ADSET: { entity: 1, context: 0 },
      AD: { entity: 1, context: 0 }
    };
    const output = run(project, UNDERPERFORMING_FLEET);
    const good = adDecision(output, "GOOD");
    expect(good?.blendedAchievement).toBe(good?.weightedAchievement);
  });
});

describe("stored projects are upgraded on read", () => {
  it("moves a version 1 scope onto the current cohort maths and drops the Today red flag", () => {
    const legacy: OptimizationScope = {
      ...baseProject().config.optimizationScopes[0],
      methodologyVersion: 1,
      cohortBenchmark: {
        enabled: true, lookbackDays: 14, minEntities: 3, minResults: 5,
        method: "AGGREGATE", excludeSelf: false, manualValue: null
      },
      windows: [
        { id: "TODAY", label: "Today", kind: "TODAY", days: null, weight: 0.4, required: false, includeInScore: true, role: "SIGNAL", minSpend: 0, minResults: 0, redFlagThreshold: 0.8 },
        { id: "D3", label: "3 Days", kind: "ROLLING", days: 3, weight: 0.6, required: true, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 1, redFlagThreshold: 0.8 }
      ]
    };
    const upgraded = upgradeScope(legacy);
    expect(upgraded.methodologyVersion).toBe(2);
    expect(upgraded.cohortBenchmark.method).toBe("MEDIAN");
    expect(upgraded.cohortBenchmark.excludeSelf).toBe(true);
    expect(upgraded.windows.find((window) => window.id === "TODAY")?.redFlagThreshold).toBeNull();
    expect(upgraded.windows.find((window) => window.id === "D3")?.redFlagThreshold).toBe(0.8);
  });

  it("leaves an already current scope alone", () => {
    const current = baseProject().config.optimizationScopes[0];
    expect(upgradeScope(current)).toBe(current);
  });
});

describe("reason codes stay informative", () => {
  it("does not repeat a red-flag window on an entity the score already turned off", () => {
    const project = baseProject();
    const output = run(project, UNDERPERFORMING_FLEET);
    const worst = adDecision(output, "WORST");
    expect(worst?.recommendedAction).toBe("TURN_OFF");
    expect(worst?.reasonCodes.some((code) => code.startsWith("WINDOW_RED_FLAG"))).toBe(false);
  });
});

describe("confidence reflects how much history stands behind a decision", () => {
  it("separates a thin sample from a thick one", () => {
    const project = baseProject();
    const thin = run(project, adFacts([
      { id: "THIN", cpl: 9000, days: 2 }, { id: "A", cpl: 1500 }, { id: "B", cpl: 2000 }
    ]));
    const thick = run(project, adFacts([
      { id: "THICK", cpl: 9000, days: 14 }, { id: "A", cpl: 1500 }, { id: "B", cpl: 2000 }
    ]));
    const thinConfidence = adDecision(thin, "THIN")?.confidence ?? 0;
    const thickConfidence = adDecision(thick, "THICK")?.confidence ?? 0;
    expect(thinConfidence).toBeGreaterThan(0);
    expect(thinConfidence).toBeLessThan(thickConfidence);
  });
});
