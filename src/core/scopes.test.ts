import { describe, expect, it } from "vitest";
import { createProject } from "@/product/defaults";
import type { FactRow, OptimizationScope } from "./schemas";
import { classifyFacts, resolvedScopes, factsForScope } from "./scopes";

function project() {
  return createProject({
    projectName: "Multi KPI",
    platform: "META",
    accountId: "act_1",
    currency: "VND",
    timezone: "Asia/Bangkok",
    startDate: "2026-07-01",
    primaryMetricKey: "CPL",
    optimizationEventLabel: "Lead",
    target: 100,
    salesModel: "LANDING_PAGE_OFFLINE_CLOSE",
    trackingConfidence: "HIGH",
    capiStatus: "VERIFIED"
  });
}

function fact(name: string, kpiMetric: string): FactRow {
  return {
    projectId: "P1", platform: "META", accountId: "act_1", date: "2026-07-30", hour: 0,
    entityLevel: "AD", campaignId: `C-${name}`, adsetId: `AS-${name}`, adId: `A-${name}`,
    entityName: name, status: "ACTIVE", budgetType: "NONE", budget: null, spend: 100,
    result: 1, qualifiedResult: null, revenue: null, impressions: 1000, clicks: 20,
    objective: null, optimizationGoal: null, learningStatus: null, postId: null,
    metrics: {}, dimensions: { kpiMetric }, sourceUpdatedAt: "2026-07-30T08:00:00+07:00",
    sourceRowKey: name
  };
}

describe("PFM scope classification", () => {
  it("routes performance rows to their KPI scope and excludes branding rows", () => {
    const item = project();
    const lead = item.config.optimizationScopes[0];
    const purchase: OptimizationScope = {
      ...structuredClone(lead),
      scopeId: "purchase",
      name: "Purchase",
      primaryMetricKey: "CPA",
      optimizationEventLabel: "Purchase",
      ruleSetId: "purchase-rules",
      fallbackClassification: "REVIEW_UNCLASSIFIED"
    };
    item.config.optimizationScopes = [
      { ...lead, fallbackClassification: "REVIEW_UNCLASSIFIED" },
      purchase
    ];
    item.config.classificationRules = [
      { id: "lead", name: "Lead", field: "dimensions.kpiMetric", operator: "EQUALS", values: ["lead"], outcome: "PFM_INCLUDED", scopeId: lead.scopeId, priority: 100, enabled: true },
      { id: "purchase", name: "Purchase", field: "dimensions.kpiMetric", operator: "EQUALS", values: ["purchase"], outcome: "PFM_INCLUDED", scopeId: purchase.scopeId, priority: 100, enabled: true },
      { id: "branding", name: "Branding", field: "dimensions.kpiMetric", operator: "IN", values: ["reach", "awareness"], outcome: "NON_PFM_EXCLUDED", scopeId: null, priority: 200, enabled: true }
    ];

    const output = classifyFacts([
      fact("Lead ad", "Lead"),
      fact("Purchase ad", "Purchase"),
      fact("Reach ad", "Reach"),
      fact("Unknown ad", "Other")
    ], item.config);

    expect(output.map((row) => [row.optimizationClass, row.scopeId])).toEqual([
      ["PFM_INCLUDED", lead.scopeId],
      ["PFM_INCLUDED", "purchase"],
      ["NON_PFM_EXCLUDED", null],
      ["REVIEW_UNCLASSIFIED", null]
    ]);
  });

  it("does not match prototype properties on FactRow (e.g. toString)", () => {
    const item = project();
    item.config.classificationRules = [
      { id: "proto", name: "Proto Test", field: "toString", operator: "CONTAINS", values: ["function"], outcome: "PFM_INCLUDED", scopeId: "s1", priority: 100, enabled: true }
    ];
    const output = classifyFacts([fact("Test ad", "Lead")], item.config);
    expect(output[0].classificationReason).not.toBe("RULE:proto");
  });
});

describe("resolvedScopes", () => {
  it("returns at least one scope when optimizationScopes is empty (legacyScope fallback)", () => {
    const item = project();
    const emptyConfig = { ...item.config, optimizationScopes: [] };
    const scopes = resolvedScopes(emptyConfig);

    expect(scopes.length).toBeGreaterThanOrEqual(1);
    expect(scopes[0].scopeId).toBe("default-pfm");
  });
});

describe("factsForScope", () => {
  it("filters facts by scopeId and PFM_INCLUDED status", () => {
    const facts: FactRow[] = [
      { ...fact("f1", "Lead"), scopeId: "scope_a", optimizationClass: "PFM_INCLUDED" },
      { ...fact("f2", "Lead"), scopeId: "scope_b", optimizationClass: "PFM_INCLUDED" },
      { ...fact("f3", "Lead"), scopeId: "scope_a", optimizationClass: "NON_PFM_EXCLUDED" },
    ];

    const filtered = factsForScope(facts, "scope_a");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sourceRowKey).toBe("f1");
  });
});
