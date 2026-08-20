import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtest";
import type { FactRow, ProjectConfig, MetricDefinition, OptimizationRule } from "./schemas";

describe("backtest", () => {
  const baseConfig: ProjectConfig = {
    projectId: "proj_1",
    projectName: "Project 1",
    platform: "META",
    accountId: "acc_1",
    timezone: "UTC",
    currency: "USD",
    startDate: "2026-01-01", planEndDate: null,
    primaryMetricKey: "CPL",
    optimizationEventLabel: "Lead",
    target: 50,
    salesModel: "OTHER",
    trackingConfidence: "HIGH",
    capiStatus: "VERIFIED",
    ruleSetId: "rs_1",
    ruleVersion: 1,
    dataFreshnessHours: 24,
    windows: [
      { id: "W1", days: 7, weight: 1.0, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null },
    ],
    optimizationScopes: [
      {
        scopeId: "scope_1",
        name: "Scope 1",
        enabled: true,
        primaryMetricKey: "CPL",
        optimizationEventLabel: "Lead",
        planTarget: 50, planTargetResults: null, estimateRate: null,
        ruleSetId: "rs_1",
        ruleVersion: 1,
        windows: [
          { id: "W1", days: 7, weight: 1.0, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null },
        ],
        achievementCap: 2,
        scaleMinWindowAchievement: 1,
        contextScaleMinAchievement: 1,
        windowBlendMethod: "ARITHMETIC", contextSource: "PROJECT",
        cohortGuard: { enabled: false, minPlanAchievement: 0.7, minCohortAchievement: 1.2 },
        methodologyVersion: 2,
        cohortBenchmark: { enabled: true, lookbackDays: 14, minEntities: 3, minResults: 5, method: "AGGREGATE", excludeSelf: true, manualValue: null },
        fallbackClassification: "PFM_INCLUDED",
  levelSettings: {},
      },
    ],
    classificationRules: [],
    contextWeights: {
      CAMPAIGN: { entity: 1, context: 0 },
      ADSET: { entity: 0.7, context: 0.3 },
      AD: { entity: 0.5, context: 0.5 },
    },
    maxDailyScalePct: 0.2,
    maxDailyScaleActions: 2,
    deferParentScaleWhenChildAction: true,
    dataSource: { kind: "CSV", autoSyncEnabled: true, syncIntervalMinutes: 60, autoRunAfterSync: true },
  };

  const metricDefinitions: MetricDefinition[] = [
    {
      key: "CPL",
      label: "Cost Per Lead",
      kind: "RATIO",
      numerator: "spend",
      denominator: "result",
      multiplier: 1,
      direction: "LOWER_IS_BETTER",
      nullWhenDenominatorZero: true,
    },
  ];

  const rules: OptimizationRule[] = [
    {
      id: "rule_1",
      ruleSetId: "rs_1",
      version: 1,
      entityLevel: "CAMPAIGN",
      metricKey: "CPL",
      scoreSource: "COMPOSITE",
      evaluationField: "ACHIEVEMENT",
      evidenceSource: "SHORT",
      minSpendAbsolute: null,
      minSpendTargetMultiple: null,
      minResults: 0,
      operator: "GT",
      thresholdFrom: 1.5,
      thresholdTo: null,
      actionCode: "DECREASE_BUDGET",
      actionValue: 0.2,
      priority: 1,
      enabled: true,
    },
  ];

  const fact1: FactRow = {
    projectId: "proj_1",
    platform: "META",
    accountId: "acc_1",
    date: "2026-01-10",
    hour: null,
    entityLevel: "CAMPAIGN",
    campaignId: "c1",
    adsetId: null,
    adId: null,
    entityName: "Campaign 1",
    status: "ACTIVE",
    budgetType: "CBO",
    budget: 100,
    spend: 200,
    result: 1,
    qualifiedResult: null,
    revenue: null,
    impressions: 1000,
    clicks: 50,
    objective: null,
    optimizationGoal: null,
    learningStatus: null,
    postId: null,
    scopeId: "scope_1",
    optimizationClass: "PFM_INCLUDED",
    metrics: {},
    dimensions: {},
    sourceUpdatedAt: "2026-01-10T10:00:00.000Z",
    sourceRowKey: "row_1",
  };

  const validBaseRequest = {
    asOfDate: "2026-01-15",
    runAt: "2026-01-15T10:00:00.000Z",
    config: baseConfig,
    metricDefinitions,
    rules,
    facts: [fact1],
    priorActions: [],
  };

  it("runs engine for a single checkpoint and returns results", () => {
    const checkpoints = [{ asOfDate: "2026-01-10", runAt: "2026-01-10T12:00:00.000Z" }];
    const result = runBacktest(validBaseRequest, checkpoints);

    expect(result.checkpoints).toBe(1);
    expect(result.runs).toHaveLength(1);
    expect(result.completed + result.blocked).toBe(1);
    expect(result.runs[0].asOfDate).toBe("2026-01-10");
  });

  it("runs multiple checkpoints and returns correct count", () => {
    const checkpoints = [
      { asOfDate: "2026-01-10", runAt: "2026-01-10T12:00:00.000Z" },
      { asOfDate: "2026-01-11", runAt: "2026-01-11T12:00:00.000Z" },
      { asOfDate: "2026-01-12", runAt: "2026-01-12T12:00:00.000Z" },
    ];
    const result = runBacktest(validBaseRequest, checkpoints);

    expect(result.checkpoints).toBe(3);
    expect(result.runs).toHaveLength(3);
    expect(result.runs[0].asOfDate).toBe("2026-01-10");
    expect(result.runs[1].asOfDate).toBe("2026-01-11");
    expect(result.runs[2].asOfDate).toBe("2026-01-12");
  });

  it("triggers Zod error on invalid request", () => {
    const invalidRequest = { ...validBaseRequest, config: null };
    expect(() => runBacktest(invalidRequest, [{ asOfDate: "2026-01-10", runAt: "2026-01-10T12:00:00.000Z" }])).toThrow();
  });
});
