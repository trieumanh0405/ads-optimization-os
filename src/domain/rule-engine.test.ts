import { describe, expect, it } from "vitest";
import { evaluateRules } from "./rule-engine";

describe("evaluateRules", () => {
  it("does not turn off an entity without enough evidence", () => {
    const decision = evaluateRules(
      {
        metricKey: "cpa",
        value: 500000,
        target: 200000,
        spend: 100000,
        results: 0,
        direction: "lower_is_better",
        dataFresh: true
      },
      [{
        id: "CPA_HIGH",
        version: 1,
        entityLevel: "ad",
        metricKey: "cpa",
        minSpend: 400000,
        minResults: 1,
        operator: "gte",
        thresholdFrom: 300000,
        action: "TURN_OFF",
        priority: 100,
        enabled: true
      }]
    );
    expect(decision.action).toBe("PENDING_DATA");
  });
});
