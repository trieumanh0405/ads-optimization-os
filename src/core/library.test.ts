import { describe, it, expect } from "vitest";
import { standardMetricLibrary } from "./library";
import { metricDefinitionSchema } from "./schemas";

describe("library", () => {
  it("conforms every standard metric to metricDefinitionSchema", () => {
    for (const metric of standardMetricLibrary) {
      expect(() => metricDefinitionSchema.parse(metric)).not.toThrow();
    }
  });

  it("contains all expected standard metric keys", () => {
    const expectedKeys = ["CPL", "CPQL", "CPA", "ROAS", "CTR", "CPC", "CVR", "CPM"];
    const actualKeys = standardMetricLibrary.map((m) => m.key);

    for (const expectedKey of expectedKeys) {
      expect(actualKeys).toContain(expectedKey);
    }
    expect(actualKeys.length).toBeGreaterThanOrEqual(expectedKeys.length);
  });
});
