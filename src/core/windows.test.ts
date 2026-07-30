import { describe, expect, it } from "vitest";
import type { FactRow } from "./schemas";
import { expandFactLevels } from "./windows";

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
});
