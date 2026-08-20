import { describe, it, expect } from "vitest";
import { runDataQualityChecks, filterUsableFacts } from "./qc";
import type { EngineRequest, FactRow, ProjectConfig, MetricDefinition, OptimizationRule } from "./schemas";

describe("qc", () => {
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
    windows: [{ id: "W1", days: 7, weight: 1.0, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null }],
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
        windows: [{ id: "W1", days: 7, weight: 1.0, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null }],
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

  const validFactRow: FactRow = {
    projectId: "proj_1",
    platform: "META",
    accountId: "acc_1",
    date: "2026-02-01",
    hour: null,
    entityLevel: "CAMPAIGN",
    campaignId: "c1",
    adsetId: null,
    adId: null,
    entityName: "Campaign 1",
    status: "ACTIVE",
    budgetType: "CBO",
    budget: 100,
    spend: 50,
    result: 5,
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
    sourceUpdatedAt: "2026-02-01T10:00:00.000Z",
    sourceRowKey: "row_1",
  };

  const validRequest: EngineRequest = {
    asOfDate: "2026-02-01",
    runAt: "2026-02-01T11:00:00.000Z",
    config: baseConfig,
    metricDefinitions,
    rules,
    facts: [validFactRow],
    priorActions: [],
  };

  it("returns PASS for valid data", () => {
    const res = runDataQualityChecks(validRequest);
    expect(res.status).toBe("PASS");
    expect(res.issues).toHaveLength(0);
    expect(res.latestSourceUpdateAt).toBe("2026-02-01T10:00:00.000Z");
  });

  it("flags empty facts as FATAL", () => {
    const req: EngineRequest = {
      ...validRequest,
      facts: [],
    };
    const res = runDataQualityChecks(req);
    expect(res.status).toBe("FAIL");
    const fatalIssue = res.issues.find((i) => i.code === "RAW_DATA_EMPTY");
    expect(fatalIssue).toBeDefined();
    expect(fatalIssue?.severity).toBe("FATAL");
  });

  it("flags duplicate sourceRowKeys as FATAL", () => {
    const req: EngineRequest = {
      ...validRequest,
      facts: [
        validFactRow,
        { ...validFactRow, sourceRowKey: "row_1" }, // Duplicate key
      ],
    };
    const res = runDataQualityChecks(req);
    expect(res.status).toBe("FAIL");
    const dupIssue = res.issues.find((i) => i.code === "DUPLICATE_SOURCE_KEYS");
    expect(dupIssue).toBeDefined();
    expect(dupIssue?.severity).toBe("FATAL");
    expect(dupIssue?.sourceRowKeys).toContain("row_1");
  });

  it("flags window weight sum != 1.0", () => {
    const req: EngineRequest = {
      ...validRequest,
      config: {
        ...baseConfig,
        optimizationScopes: [
          {
            ...baseConfig.optimizationScopes[0],
            windows: [
              { id: "W1", days: 7, weight: 0.5, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null },
            ],
          },
        ],
      },
    };
    const res = runDataQualityChecks(req);
    expect(res.status).toBe("FAIL");
    const weightIssue = res.issues.find((i) => i.code.startsWith("WINDOW_WEIGHTS_NOT_100"));
    expect(weightIssue).toBeDefined();
  });

  it("filterUsableFacts filters out future dates relative to asOfDate", () => {
    const facts: FactRow[] = [
      { ...validFactRow, sourceRowKey: "past", date: "2026-01-30" },
      { ...validFactRow, sourceRowKey: "today", date: "2026-02-01" },
      { ...validFactRow, sourceRowKey: "future", date: "2026-02-02" },
    ];
    const usable = filterUsableFacts(facts, "2026-02-01");
    expect(usable).toHaveLength(2);
    expect(usable.map((f) => f.sourceRowKey)).toEqual(["past", "today"]);
  });
});
