import { describe, expect, it } from "vitest";
import { evaluateEntity, ownsBudget } from "./rules";
import type { EntityEvidence } from "./windows";
import type { ProjectConfig, OptimizationRule } from "./schemas";

const evidence = (level: "CAMPAIGN" | "ADSET" | "AD", budgetType: "CBO" | "ABO" | "NONE"): EntityEvidence => ({
  entityLevel: level, entityId: "X", entityName: "Entity", campaignId: "C1",
  adsetId: level === "CAMPAIGN" ? null : "AS1", adId: level === "AD" ? "A1" : null,
  status: "ACTIVE", budgetType,
  windows: {
    TODAY: { id: "TODAY", start: "2026-07-20", endExclusive: "2026-07-21", totals: { spend: 1000, result: 10, qualifiedResult: 0, revenue: 0, impressions: 10000, clicks: 100, metrics: {} }, value: 100, achievement: 1, rowCount: 1 },
    SHORT: { id: "SHORT", start: "2026-07-17", endExclusive: "2026-07-20", totals: { spend: 3000, result: 30, qualifiedResult: 0, revenue: 0, impressions: 30000, clicks: 300, metrics: {} }, value: 100, achievement: 1, rowCount: 3 },
    LONG: null, LIFETIME: null
  },
  weightedAchievement: 1, projectWeightedAchievement: 1
});
const config: ProjectConfig = {
  projectId: "P", projectName: "P", platform: "META", accountId: "act_1", timezone: "Asia/Bangkok", currency: "VND", startDate: "2026-07-01",
  primaryMetricKey: "CPL", optimizationEventLabel: "Lead", salesModel: "ONLINE_CHECKOUT", trackingConfidence: "HIGH", capiStatus: "UNKNOWN",
  target: 100, ruleSetId: "R", ruleVersion: 1, dataFreshnessHours: 6,
  windows: [{ id: "TODAY", days: 1, weight: 0.4, required: true }, { id: "SHORT", days: 3, weight: 0.6, required: true }],
  contextWeights: { CAMPAIGN: { entity: 1, context: 0 }, ADSET: { entity: 1, context: 0 }, AD: { entity: 1, context: 0 } },
  maxDailyScalePct: 0.2, maxDailyScaleActions: 3, deferParentScaleWhenChildAction: true, dataSource: { kind: "CSV" }
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
    const output = evaluateEntity(item, [item], [rule("SCALE", "INCREASE_BUDGET")], config, metric);
    expect(output.recommendedAction).toBe("INCREASE_BUDGET");
    expect(output.adjustmentPct).toBe(0.2);
    expect(output.reasonCodes).toContain("ADJUSTMENT_CAPPED_BY_GUARDRAIL");
  });
  it("sends equal-priority opposite actions to manual review", () => {
    const item = evidence("ADSET", "ABO");
    const output = evaluateEntity(item, [item], [rule("UP", "INCREASE_BUDGET"), rule("DOWN", "DECREASE_BUDGET")], config, metric);
    expect(output.recommendedAction).toBe("REVIEW_MANUALLY");
    expect(output.reasonCodes).toContain("CONFLICTING_RULES");
  });
});
