import { describe, expect, it } from "vitest";
import { createActionRecords, transitionAction } from "./actions";
import type { Recommendation } from "./rules";

const recommendation: Recommendation = {
  scopeId: "default-pfm", scopeName: "Lead", ruleSetId: "RULES", ruleVersion: 1,
  entityLevel: "AD", entityId: "A1", entityName: "Ad", campaignId: "C1", adsetId: "AS1",
  currentStatus: "ACTIVE", budgetType: "NONE", recommendedAction: "TURN_OFF", adjustmentPct: null,
  reasonCodes: ["RULE_AD_OFF"], matchedRuleIds: ["AD_OFF"], evidenceWindow: "TODAY + SHORT",
  currentMetric: 200, targetMetric: 100, evaluatedValue: 0.5,
  weightedAchievement: 0.5, contextWeightedAchievement: 0.6,
  cohortWeightedAchievement: 0.7, cohortBenchmark: 120,
  minimumWindowAchievement: 0.4, trendRatio: 0.8, redFlagWindowIds: [],
  confidence: 0.8, executionPhase: 1, windowMetrics: []
};

describe("action lifecycle", () => {
  it("deduplicates an open recommendation with the same evidence", () => {
    const first = createActionRecords({ recommendations: [recommendation], runId: "R1", runAt: "2026-07-20T08:00:00Z", projectId: "P", existing: [] });
    const second = createActionRecords({ recommendations: [recommendation], runId: "R2", runAt: "2026-07-20T09:00:00Z", projectId: "P", existing: [{ actionKey: first[0].actionKey, approvalStatus: "PENDING" }] });
    expect(second).toHaveLength(0);
  });
  it("does not recreate a completed action until its evidence changes", () => {
    const first = createActionRecords({ recommendations: [recommendation], runId: "R1", runAt: "2026-07-20T08:00:00Z", projectId: "P", existing: [] });
    const repeated = createActionRecords({
      recommendations: [recommendation],
      runId: "R2",
      runAt: "2026-07-20T10:00:00Z",
      projectId: "P",
      existing: [{ actionKey: first[0].actionKey, approvalStatus: "DONE" }]
    });
    expect(repeated).toHaveLength(0);
  });
  it("keeps terminal actions immutable and appends an audit event", () => {
    const action = createActionRecords({ recommendations: [recommendation], runId: "R1", runAt: "2026-07-20T08:00:00Z", projectId: "P", existing: [] })[0];
    const done = transitionAction(action, "DONE", "buyer@example.com", "2026-07-20T09:00:00Z", "Executed in Meta");
    expect(done.action.executedAt).toBe("2026-07-20T09:00:00Z");
    expect(done.event.from).toBe("PENDING");
    expect(() => transitionAction(done.action, "REJECTED", "leader", "2026-07-20T10:00:00Z", null)).toThrow();
  });
});
