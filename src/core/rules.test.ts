import { describe, expect, it } from "vitest";
import { evaluateEntity, ownsBudget } from "./rules";
import type { EntityEvidence } from "./windows";
import type { ProjectConfig, OptimizationRule, OptimizationScope } from "./schemas";

const windowEvidence = (id: string, role: "SIGNAL" | "CONFIRMATION") => ({
  id, label: id, role, includeInScore: true,
  start: "2026-07-20", endExclusive: "2026-07-21",
  totals: { spend: 1000, result: 10, qualifiedResult: 0, revenue: 0, impressions: 10000, clicks: 100, metrics: {} },
  value: 100, achievement: 1, rowCount: 1, evidenceCount: 10, eligible: true
});

const evidence = (level: "CAMPAIGN" | "ADSET" | "AD", budgetType: "CBO" | "ABO" | "NONE"): EntityEvidence => ({
  entityLevel: level, entityId: "X", entityName: "Entity", campaignId: "C1",
  adsetId: level === "CAMPAIGN" ? null : "AS1", adId: level === "AD" ? "A1" : null,
  status: "ACTIVE", budgetType,
  windows: {
    TODAY: windowEvidence("TODAY", "SIGNAL"),
    SHORT: windowEvidence("SHORT", "CONFIRMATION"),
    LONG: null, LIFETIME: null
  },
  scopeId: "default-pfm", scopeName: "Lead",
  weightedAchievement: 1, minimumWindowAchievement: 1, trendRatio: 1, redFlagWindowIds: [],
  projectWeightedAchievement: 1, cohortWeightedAchievement: 1, cohortBenchmark: 100
});
const config: ProjectConfig = {
  projectId: "P", projectName: "P", platform: "META", accountId: "act_1", timezone: "Asia/Bangkok", currency: "VND", startDate: "2026-07-01",
  primaryMetricKey: "CPL", optimizationEventLabel: "Lead", salesModel: "ONLINE_CHECKOUT", trackingConfidence: "HIGH", capiStatus: "UNKNOWN",
  target: 100, ruleSetId: "R", ruleVersion: 1, dataFreshnessHours: 6,
  windows: [
    { id: "TODAY", label: "Today", kind: "TODAY", days: null, weight: 0.4, required: true, includeInScore: true, role: "SIGNAL", minSpend: 0, minResults: 0, redFlagThreshold: null },
    { id: "SHORT", label: "3 Days", kind: "ROLLING", days: 3, weight: 0.6, required: true, includeInScore: true, role: "CONFIRMATION", minSpend: 0, minResults: 0, redFlagThreshold: null }
  ],
  optimizationScopes: [], classificationRules: [],
  contextWeights: { CAMPAIGN: { entity: 1, context: 0 }, ADSET: { entity: 1, context: 0 }, AD: { entity: 1, context: 0 } },
  maxDailyScalePct: 0.2, maxDailyScaleActions: 3, deferParentScaleWhenChildAction: true,
  dataSource: { kind: "CSV", autoSyncEnabled: false, syncIntervalMinutes: 60, autoRunAfterSync: false }
};
const scope: OptimizationScope = {
  scopeId: "default-pfm", name: "Lead", enabled: true, primaryMetricKey: "CPL",
  optimizationEventLabel: "Lead", planTarget: 100, ruleSetId: "R", ruleVersion: 1,
  windows: config.windows, achievementCap: 2, scaleMinWindowAchievement: 1,
  contextScaleMinAchievement: 1,
  cohortBenchmark: { enabled: true, lookbackDays: 14, minEntities: 3, minResults: 5, method: "AGGREGATE", manualValue: null },
  fallbackClassification: "PFM_INCLUDED"
};
const metric = { key: "CPL", label: "CPL", kind: "RATIO", numerator: "spend", denominator: "result", multiplier: 1, direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true } as const;
const rule = (id: string, actionCode: OptimizationRule["actionCode"], priority = 10): OptimizationRule => ({
  id, ruleSetId: "R", version: 1, entityLevel: "ADSET", metricKey: "CPL", scoreSource: "WEIGHTED",
  evaluationField: "ACHIEVEMENT", evidenceSource: "TODAY_PLUS_SHORT",
  minSpendAbsolute: 100, minSpendTargetMultiple: null, minResults: 2,
  operator: "GTE", thresholdFrom: 0, thresholdTo: null, actionCode, actionValue: 0.5, priority, enabled: true
});

describe("rule guardrails", () => {
  it("recognizes CBO/ABO budget ownership", () => {
    expect(ownsBudget(evidence("CAMPAIGN", "CBO"))).toBe(true);
    expect(ownsBudget(evidence("ADSET", "CBO"))).toBe(false);
    expect(ownsBudget(evidence("ADSET", "ABO"))).toBe(true);
    expect(ownsBudget(evidence("AD", "NONE"))).toBe(false);
  });
  it("caps a valid ABO budget adjustment", () => {
    const item = evidence("ADSET", "ABO");
    const output = evaluateEntity(item, [item], [rule("SCALE", "INCREASE_BUDGET")], config, metric, scope);
    expect(output.recommendedAction).toBe("INCREASE_BUDGET");
    expect(output.adjustmentPct).toBe(0.2);
    expect(output.reasonCodes).toContain("ADJUSTMENT_CAPPED_BY_GUARDRAIL");
  });
  it("sends equal-priority opposite actions to manual review", () => {
    const item = evidence("ADSET", "ABO");
    const output = evaluateEntity(item, [item], [rule("UP", "INCREASE_BUDGET"), rule("DOWN", "DECREASE_BUDGET")], config, metric, scope);
    expect(output.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(output.reasonCodes).toContain("CONFLICTING_RULES");
  });
  it("raises manual review when one configured window breaches its red-flag floor", () => {
    const item = { ...evidence("ADSET", "ABO"), redFlagWindowIds: ["TODAY"] };
    const output = evaluateEntity(item, [item], [rule("KEEP", "KEEP")], config, metric, scope);
    expect(output.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(output.reasonCodes).toContain("WINDOW_RED_FLAG_TODAY");
  });
  it("migrates legacy CONTEXT_WEIGHTED rules to Plan geometric while keeping Context separate", () => {
    const item = {
      ...evidence("ADSET", "ABO"),
      weightedAchievement: 1.2,
      projectWeightedAchievement: 0.5
    };
    const legacyRule = {
      ...rule("LEGACY", "KEEP"),
      scoreSource: "CONTEXT_WEIGHTED",
      operator: "GTE" as const,
      thresholdFrom: 1.1
    };
    const output = evaluateEntity(item, [item], [legacyRule], config, metric, scope);
    expect(output.recommendedAction).toBe("KEEP");
    expect(output.weightedAchievement).toBe(1.2);
    expect(output.contextWeightedAchievement).toBe(0.5);
  });
});
