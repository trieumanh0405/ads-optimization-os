import { describe, expect, it } from "vitest";
import { runOptimizationEngine } from "./engine";

const base = {
  asOfDate: "2026-07-20",
  runAt: "2026-07-20T08:00:00+07:00",
  config: {
    projectId: "P1", projectName: "Lead project", platform: "META", accountId: "act_1", timezone: "Asia/Bangkok", currency: "VND",
    startDate: "2026-07-01", primaryMetricKey: "CPL", target: 100,
    ruleSetId: "LEAD", ruleVersion: 1, dataFreshnessHours: 6,
    windows: [
      { id: "TODAY", days: 1, weight: 0.4, required: true },
      { id: "SHORT", days: 3, weight: 0.6, required: true }
    ],
    contextWeights: {
      CAMPAIGN: { entity: 1, context: 0 },
      ADSET: { entity: 0.7, context: 0.3 },
      AD: { entity: 1, context: 0 }
    },
    maxDailyScalePct: 0.2, maxDailyScaleActions: 2, deferParentScaleWhenChildAction: true
  },
  metricDefinitions: [{ key: "CPL", label: "Cost per lead", kind: "RATIO", numerator: "spend", denominator: "result", direction: "LOWER_IS_BETTER", nullWhenDenominatorZero: true }],
  rules: [
    { id: "AD_OFF", ruleSetId: "LEAD", version: 1, entityLevel: "AD", metricKey: "CPL", scoreSource: "CONTEXT_WEIGHTED", minSpendAbsolute: 100, minSpendTargetMultiple: null, minResults: 2, operator: "LT", thresholdFrom: 0.8, thresholdTo: null, actionCode: "TURN_OFF", actionValue: null, priority: 100, enabled: true },
    { id: "AD_KEEP", ruleSetId: "LEAD", version: 1, entityLevel: "AD", metricKey: "CPL", scoreSource: "CONTEXT_WEIGHTED", minSpendAbsolute: 100, minSpendTargetMultiple: null, minResults: 2, operator: "GTE", thresholdFrom: 0.8, thresholdTo: null, actionCode: "KEEP", actionValue: null, priority: 100, enabled: true }
  ],
  facts: [] as unknown[],
  priorActions: []
};

const row = (date: string, spend: number, result: number) => ({
  projectId: "P1", platform: "META", accountId: "act_1", date, hour: 0,
  entityLevel: "AD", campaignId: "C1", adsetId: "AS1", adId: "AD1", entityName: "Weak ad",
  status: "ACTIVE", budgetType: "NONE", budget: null, spend, result, qualifiedResult: null,
  revenue: null, impressions: 1000, clicks: 20, sourceUpdatedAt: "2026-07-20T07:00:00+07:00",
  sourceRowKey: `P1|${date}|AD|AD1`
});

describe("production optimization engine", () => {
  it("blocks stale data instead of returning destructive actions", () => {
    const output = runOptimizationEngine({ ...base, runAt: "2026-07-21T20:00:00+07:00", facts: [row("2026-07-20", 500, 2)] });
    expect(output.status).toBe("BLOCKED");
    expect(output.qc.issues.some((item) => item.code === "SOURCE_DATA_STALE")).toBe(true);
  });
  it("excludes today from the prior short window and turns off with sufficient evidence", () => {
    const facts = [row("2026-07-20", 500, 2), row("2026-07-19", 400, 2), row("2026-07-18", 400, 2)];
    const output = runOptimizationEngine({ ...base, facts });
    expect(output.status).toBe("COMPLETED");
    expect(output.evidence[0].windows.TODAY?.totals.spend).toBe(500);
    expect(output.evidence[0].windows.SHORT?.totals.spend).toBe(800);
    expect(output.recommendations[0].recommendedAction).toBe("TURN_OFF");
  });
  it("returns pending when denominator data is absent", () => {
    const output = runOptimizationEngine({ ...base, facts: [row("2026-07-20", 500, 0), row("2026-07-19", 500, 0)] });
    expect(output.recommendations[0].recommendedAction).toBe("PENDING_DATA");
  });
});
