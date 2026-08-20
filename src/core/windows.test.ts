import { describe, expect, it } from "vitest";
import type { FactRow, ProjectConfig, MetricDefinition, OptimizationScope } from "./schemas";
import { expandFactLevels, windowBounds, buildEntityEvidence } from "./windows";

const adFact: FactRow = {
  projectId: "p1", platform: "META", accountId: "a1", date: "2026-07-30", hour: null,
  entityLevel: "AD", campaignId: "c1", adsetId: "as1", adId: "ad1", entityName: "Creative 1",
  status: "ACTIVE", budgetType: "ABO", budget: null, spend: 100, result: 2,
  qualifiedResult: null, revenue: null, impressions: 1_000, clicks: 20,
  objective: null, optimizationGoal: null, learningStatus: null, postId: null,
  metrics: {}, dimensions: { campaignName: "Campaign 1", adsetName: "Ad set 1" },
  sourceUpdatedAt: "2026-07-30T08:00:00+07:00", sourceRowKey: "p1|2026-07-30|ad1"
};

describe("fact level expansion", () => {
  it("derives parent levels from an ad-level export", () => {
    const expanded = expandFactLevels([adFact]);
    expect(expanded.map((item) => item.entityLevel)).toEqual(["AD", "ADSET", "CAMPAIGN"]);
    expect(expanded[1].entityName).toBe("Ad set 1");
    expect(expanded[2].entityName).toBe("Campaign 1");
  });

  it("does not derive a level that was imported explicitly", () => {
    const explicitAdset = { ...adFact, entityLevel: "ADSET" as const, adId: null, entityName: "Explicit ad set" };
    const expanded = expandFactLevels([adFact, explicitAdset]);
    expect(expanded.filter((item) => item.entityLevel === "ADSET")).toHaveLength(1);
  });

  it("supports arbitrary rolling windows such as 6D and 14D", () => {
    expect(windowBounds({
      id: "D6", label: "6 Days", kind: "ROLLING", days: 6, weight: 0.5,
      required: true, includeInScore: true, role: "SIGNAL", minSpend: 0,
      minResults: 0, redFlagThreshold: null
    }, "2026-07-30", "2026-07-01")).toEqual({
      start: "2026-07-24",
      endExclusive: "2026-07-30"
    });
    expect(windowBounds({
      id: "D14", label: "14 Days", kind: "ROLLING", days: 14, weight: 0.5,
      required: true, includeInScore: true, role: "BASELINE", minSpend: 0,
      minResults: 0, redFlagThreshold: null
    }, "2026-07-30", "2026-07-01")).toEqual({
      start: "2026-07-16",
      endExclusive: "2026-07-30"
    });
  });

  it("uses projectStartDate for LIFETIME windowBounds", () => {
    const bounds = windowBounds({
      id: "LIFETIME", label: "Lifetime", kind: "LIFETIME", days: null, weight: 1.0,
      required: false, includeInScore: true, role: "BASELINE", minSpend: 0,
      minResults: 0, redFlagThreshold: null
    }, "2026-07-30", "2026-01-01");

    expect(bounds.start).toBe("2026-01-01");
    expect(bounds.endExclusive).toBe("2026-07-31");
  });
});

describe("buildEntityEvidence", () => {
  it("returns evidence for each entity", () => {
    const config: ProjectConfig = {
      projectId: "p1", projectName: "Project 1", platform: "META", accountId: "a1",
      timezone: "UTC", currency: "USD", startDate: "2026-01-01", planEndDate: null, primaryMetricKey: "CPL",
      optimizationEventLabel: "Lead", target: 50, salesModel: "OTHER", trackingConfidence: "HIGH",
      capiStatus: "VERIFIED", ruleSetId: "rs1", ruleVersion: 1, dataFreshnessHours: 24,
      windows: [{ id: "D7", days: 7, weight: 1.0, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null }],
      optimizationScopes: [], classificationRules: [],
      contextWeights: {
        CAMPAIGN: { entity: 1, context: 0 },
        ADSET: { entity: 0.7, context: 0.3 },
        AD: { entity: 0.5, context: 0.5 }
      },
      maxDailyScalePct: 0.2, maxDailyScaleActions: 2, deferParentScaleWhenChildAction: true,
      dataSource: { kind: "CSV", autoSyncEnabled: true, syncIntervalMinutes: 60, autoRunAfterSync: true }
    };

    const definition: MetricDefinition = {
      key: "CPL", label: "Cost Per Lead", kind: "RATIO", numerator: "spend", denominator: "result",
      multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true
    };

    const scope: OptimizationScope = {
      scopeId: "s1", name: "Scope 1", enabled: true, primaryMetricKey: "CPL",
      optimizationEventLabel: "Lead", planTarget: 50, planTargetResults: null, estimateRate: null, ruleSetId: "rs1", ruleVersion: 1,
      windows: [{ id: "D7", days: 7, weight: 1.0, required: false, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null }],
      achievementCap: 2, scaleMinWindowAchievement: 1, contextScaleMinAchievement: 1,
      windowBlendMethod: "ARITHMETIC", contextSource: "PROJECT",
        cohortGuard: { enabled: false, minPlanAchievement: 0.7, minCohortAchievement: 1.2 },
        methodologyVersion: 2,
        cohortBenchmark: { enabled: true, lookbackDays: 14, minEntities: 3, minResults: 5, method: "AGGREGATE", excludeSelf: true, manualValue: null },
      fallbackClassification: "PFM_INCLUDED",
  levelSettings: {}
    };

    const evidence = buildEntityEvidence([adFact], config, definition, "2026-07-30", scope);

    // Ad fact expands to AD, ADSET, and CAMPAIGN evidence items
    expect(evidence.length).toBeGreaterThanOrEqual(3);
    const entityLevels = evidence.map((e) => e.entityLevel);
    expect(entityLevels).toContain("AD");
    expect(entityLevels).toContain("ADSET");
    expect(entityLevels).toContain("CAMPAIGN");

    const adEvidence = evidence.find((e) => e.entityLevel === "AD");
    expect(adEvidence).toBeDefined();
    expect(adEvidence?.entityId).toBe("ad1");
    expect(adEvidence?.windows["D7"]).toBeDefined();
  });
});
