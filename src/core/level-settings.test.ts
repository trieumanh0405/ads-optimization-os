import { describe, expect, it } from "vitest";
import { runOptimizationEngine } from "./engine";
import { levelSettingsFor } from "./scopes";
import { buildDefaultRules } from "@/product/defaults";
import type { FactRow, MetricDefinition, OptimizationScope, ProjectConfig } from "./schemas";

const AS_OF = "2026-08-18";
const RUN_AT = "2026-08-18T10:58:00+07:00";

const day = (back: number) => {
  const date = new Date(`${AS_OF}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
};

const window = (id: string, days: number | null, weight: number) => ({
  id, days, weight, required: false, includeInScore: true,
  role: "CONFIRMATION" as const, minSpend: 0, minResults: 0, redFlagThreshold: null
});

const scope: OptimizationScope = {
  scopeId: "s1", name: "Page Like", enabled: true, primaryMetricKey: "CPL",
  optimizationEventLabel: "Page Like", planTarget: 2500, planTargetResults: null, estimateRate: null,
  ruleSetId: "rs1", ruleVersion: 1,
  windows: [window("D3", 3, 1)],
  achievementCap: 2, scaleMinWindowAchievement: 1, contextScaleMinAchievement: 1,
  windowBlendMethod: "ARITHMETIC", contextSource: "PARENT",
  cohortBenchmark: { enabled: false, lookbackDays: 14, minEntities: 3, minResults: 5, method: "MEDIAN", excludeSelf: true, manualValue: null },
  cohortGuard: { enabled: false, minPlanAchievement: 0.7, minCohortAchievement: 1.2 },
  methodologyVersion: 2, fallbackClassification: "PFM_INCLUDED", levelSettings: {}
};

const definition: MetricDefinition = {
  key: "CPL", label: "Cost per like", kind: "RATIO", numerator: "spend", denominator: "result",
  multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true
};

const config: ProjectConfig = {
  projectId: "P", projectName: "Panasonic", platform: "META", accountId: "act_1",
  timezone: "Asia/Bangkok", currency: "VND", startDate: "2026-08-01", planEndDate: null,
  primaryMetricKey: "CPL", optimizationEventLabel: "Page Like", target: 2500,
  salesModel: "MESSAGING_OFFLINE_CLOSE", trackingConfidence: "MEDIUM", capiStatus: "VERIFIED",
  ruleSetId: "rs1", ruleVersion: 1, dataFreshnessHours: 72,
  windows: [window("D3", 3, 1)],
  optimizationScopes: [scope], classificationRules: [],
  contextWeights: {
    CAMPAIGN: { entity: 0.6, context: 0.4 },
    ADSET: { entity: 0.6, context: 0.4 },
    AD: { entity: 0.6, context: 0.4 }
  },
  maxDailyScalePct: 0.2, maxDailyScaleActions: 3, deferParentScaleWhenChildAction: true,
  dataSource: { kind: "CSV", autoSyncEnabled: false, syncIntervalMinutes: 60, autoRunAfterSync: false }
};

/**
 * One strong ad sharing an ad set with two weak ones. This is the shape that
 * made the buyer distrust the tool: the good ad was recommended off because the
 * ad set it sits in was failing.
 */
function facts(): FactRow[] {
  const rows: FactRow[] = [];
  const ads: Array<[string, number]> = [["good", 1500], ["weak1", 6000], ["weak2", 6500]];
  for (const [adId, costPerResult] of ads) {
    for (let back = 0; back < 12; back += 1) {
      rows.push({
        projectId: "P", platform: "META", accountId: "act_1", date: day(back), hour: null,
        entityLevel: "AD", campaignId: "c1", adsetId: "as1", adId,
        entityName: `Ad ${adId}`, status: "ACTIVE", budgetType: "ABO", budget: null,
        spend: costPerResult * 4, result: 4, qualifiedResult: null, revenue: null,
        impressions: 1000, clicks: 20, objective: null, optimizationGoal: null,
        learningStatus: null, postId: null, metrics: {}, dimensions: {},
        sourceUpdatedAt: RUN_AT, sourceRowKey: `P|${day(back)}|AD|${adId}`
      });
    }
  }
  return rows;
}

function decide(projectConfig: ProjectConfig) {
  const output = runOptimizationEngine({
    asOfDate: AS_OF, runAt: RUN_AT, config: projectConfig,
    metricDefinitions: [definition], rules: buildDefaultRules("CPL", "rs1", config.windows),
    facts: facts(), priorActions: []
  });
  const ad = output.recommendations.find((item) => item.entityLevel === "AD" && item.entityId === "good");
  if (!ad) throw new Error("the strong ad produced no decision");
  return ad;
}

describe("per-level settings", () => {
  it("inherits the scope when a level says nothing, so stored projects do not shift", () => {
    const resolved = levelSettingsFor(scope, config, "AD");
    expect(resolved.windows.map((item) => item.id)).toEqual(["D3"]);
    expect(resolved.contextWeights).toEqual({ entity: 0.6, context: 0.4 });
    expect(resolved.windowBlendMethod).toBe("ARITHMETIC");
    expect(resolved.contextSource).toBe("PARENT");
  });

  it("lets a level override only what it names and keep inheriting the rest", () => {
    const resolved = levelSettingsFor(
      { ...scope, levelSettings: { AD: { windows: null, contextWeights: { entity: 1, context: 0 }, windowBlendMethod: "GEOMETRIC", contextSource: null } } },
      config,
      "AD"
    );
    expect(resolved.contextWeights).toEqual({ entity: 1, context: 0 });
    expect(resolved.windowBlendMethod).toBe("GEOMETRIC");
    expect(resolved.windows.map((item) => item.id)).toEqual(["D3"]);
    expect(resolved.contextSource).toBe("PARENT");
  });

  it("keeps every other level on its own settings", () => {
    const withAdOverride = {
      ...scope,
      levelSettings: { AD: { windows: null, contextWeights: { entity: 1, context: 0 }, windowBlendMethod: null, contextSource: null } }
    };
    expect(levelSettingsFor(withAdOverride, config, "ADSET").contextWeights).toEqual({ entity: 0.6, context: 0.4 });
    expect(levelSettingsFor(withAdOverride, config, "CAMPAIGN").contextWeights).toEqual({ entity: 0.6, context: 0.4 });
  });

  it("stops a failing ad set from dragging a strong ad down once AD scores on itself", () => {
    const blended = decide(config);
    const ownScoreOnly = decide({
      ...config,
      optimizationScopes: [{
        ...scope,
        levelSettings: { AD: { windows: null, contextWeights: { entity: 1, context: 0 }, windowBlendMethod: null, contextSource: null } }
      }]
    });

    // Same ad, same data: only the weighting layer changed.
    expect(ownScoreOnly.weightedAchievement).toBeCloseTo(blended.weightedAchievement ?? 0, 6);
    expect(blended.blendedAchievement).toBeLessThan(blended.weightedAchievement ?? 0);
    expect(ownScoreOnly.blendedAchievement).toBeCloseTo(ownScoreOnly.weightedAchievement ?? 0, 6);
    expect(ownScoreOnly.recommendedAction).not.toBe("TURN_OFF");
  });

  it("scores each level on its own windows", () => {
    const output = runOptimizationEngine({
      asOfDate: AS_OF, runAt: RUN_AT,
      config: {
        ...config,
        optimizationScopes: [{
          ...scope,
          // The ad reads three days; the ad set waits for ten.
          levelSettings: {
            AD: { windows: [window("D3", 3, 1)], contextWeights: null, windowBlendMethod: null, contextSource: null },
            ADSET: { windows: [window("D10", 10, 1)], contextWeights: null, windowBlendMethod: null, contextSource: null }
          }
        }]
      },
      metricDefinitions: [definition], rules: buildDefaultRules("CPL", "rs1", config.windows),
    facts: facts(), priorActions: []
    });
    const ad = output.evidence.find((item) => item.entityLevel === "AD");
    const adset = output.evidence.find((item) => item.entityLevel === "ADSET");
    expect(Object.keys(ad?.windows ?? {})).toEqual(["D3"]);
    expect(Object.keys(adset?.windows ?? {})).toEqual(["D10"]);
  });
});
