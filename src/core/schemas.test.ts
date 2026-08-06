import { describe, it, expect } from "vitest";
import {
  factRowSchema,
  optimizationRuleSchema,
  projectConfigSchema,
  entityLevelSchema,
  metricDefinitionSchema,
} from "./schemas";

describe("schemas", () => {
  describe("factRowSchema", () => {
    it("validates correct data", () => {
      const validFact = {
        projectId: "proj1",
        platform: "META",
        accountId: "acc1",
        date: "2026-01-15",
        entityLevel: "CAMPAIGN",
        campaignId: "c1",
        entityName: "Campaign 1",
        spend: 100,
        sourceUpdatedAt: "2026-01-15T10:00:00.000Z",
        sourceRowKey: "row_1",
      };

      const parsed = factRowSchema.parse(validFact);
      expect(parsed.projectId).toBe("proj1");
      expect(parsed.date).toBe("2026-01-15");
      expect(parsed.spend).toBe(100);
      expect(parsed.hour).toBeNull();
      expect(parsed.status).toBe("UNKNOWN");
    });

    it("rejects invalid dates", () => {
      const invalidFact = {
        projectId: "proj1",
        platform: "META",
        accountId: "acc1",
        date: "invalid-date",
        entityLevel: "CAMPAIGN",
        campaignId: "c1",
        entityName: "Campaign 1",
        spend: 100,
        sourceUpdatedAt: "2026-01-15T10:00:00.000Z",
        sourceRowKey: "row_1",
      };

      expect(() => factRowSchema.parse(invalidFact)).toThrow();
    });
  });

  describe("optimizationRuleSchema", () => {
    it("validates actionValue cap at max(1) and min(-1)", () => {
      const baseRule = {
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
        actionCode: "INCREASE_BUDGET",
        priority: 1,
        enabled: true,
      };

      // Valid values within [-1, 1]
      expect(optimizationRuleSchema.parse({ ...baseRule, actionValue: 0.2 }).actionValue).toBe(0.2);
      expect(optimizationRuleSchema.parse({ ...baseRule, actionValue: 1 }).actionValue).toBe(1);
      expect(optimizationRuleSchema.parse({ ...baseRule, actionValue: -1 }).actionValue).toBe(-1);
      expect(optimizationRuleSchema.parse({ ...baseRule, actionValue: null }).actionValue).toBeNull();

      // Invalid values exceeding cap
      expect(() => optimizationRuleSchema.parse({ ...baseRule, actionValue: 1.5 })).toThrow();
      expect(() => optimizationRuleSchema.parse({ ...baseRule, actionValue: -1.5 })).toThrow();
    });
  });

  describe("projectConfigSchema", () => {
    it("enforces currency to be exactly 3 characters", () => {
      const baseConfig = {
        projectId: "p1",
        projectName: "Project 1",
        platform: "META",
        accountId: "acc1",
        timezone: "Asia/Bangkok",
        startDate: "2026-01-01",
        primaryMetricKey: "CPL",
        target: 50,
        ruleSetId: "rs_1",
        ruleVersion: 1,
        dataFreshnessHours: 24,
        windows: [{ id: "W1", days: 7, weight: 1.0 }],
        contextWeights: {
          CAMPAIGN: { entity: 1, context: 0 },
          ADSET: { entity: 0.7, context: 0.3 },
          AD: { entity: 0.5, context: 0.5 },
        },
        maxDailyScalePct: 0.2,
        maxDailyScaleActions: 2,
      };

      // Valid 3-char currency
      expect(projectConfigSchema.parse({ ...baseConfig, currency: "USD" }).currency).toBe("USD");
      expect(projectConfigSchema.parse({ ...baseConfig, currency: "VND" }).currency).toBe("VND");

      // Invalid currency length
      expect(() => projectConfigSchema.parse({ ...baseConfig, currency: "US" })).toThrow();
      expect(() => projectConfigSchema.parse({ ...baseConfig, currency: "USDT" })).toThrow();
    });
  });

  describe("entityLevelSchema", () => {
    it("validates valid entity level enums and rejects invalid ones", () => {
      expect(entityLevelSchema.parse("CAMPAIGN")).toBe("CAMPAIGN");
      expect(entityLevelSchema.parse("ADSET")).toBe("ADSET");
      expect(entityLevelSchema.parse("AD")).toBe("AD");

      expect(() => entityLevelSchema.parse("ACCOUNT")).toThrow();
      expect(() => entityLevelSchema.parse("campaign")).toThrow();
    });
  });

  describe("metricDefinitionSchema", () => {
    it("validates metric definitions with valid operands and properties", () => {
      const validMetric = {
        key: "CPL",
        label: "Cost Per Lead",
        kind: "RATIO",
        numerator: "spend",
        denominator: "result",
        multiplier: 1,
        direction: "LOWER_IS_BETTER",
        nullWhenDenominatorZero: true,
      };

      const parsed = metricDefinitionSchema.parse(validMetric);
      expect(parsed.key).toBe("CPL");
      expect(parsed.kind).toBe("RATIO");
      expect(parsed.direction).toBe("LOWER_IS_BETTER");

      // Custom metric operand format
      const customMetric = {
        ...validMetric,
        numerator: "metrics.custom_spend",
      };
      expect(metricDefinitionSchema.parse(customMetric).numerator).toBe("metrics.custom_spend");
    });

    it("rejects invalid metric operands or invalid kinds", () => {
      const invalidOperand = {
        key: "CPL",
        label: "Cost Per Lead",
        kind: "RATIO",
        numerator: "invalid_field",
        denominator: "result",
        direction: "LOWER_IS_BETTER",
      };
      expect(() => metricDefinitionSchema.parse(invalidOperand)).toThrow();

      const invalidKind = {
        key: "CPL",
        label: "Cost Per Lead",
        kind: "AVERAGE",
        numerator: "spend",
        denominator: "result",
        direction: "LOWER_IS_BETTER",
      };
      expect(() => metricDefinitionSchema.parse(invalidKind)).toThrow();
    });
  });
});
