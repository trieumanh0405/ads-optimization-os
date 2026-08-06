import { describe, expect, it } from "vitest";
import { normalizeRows } from "./normalize";

describe("source mapping", () => {
  const baseContext = {
    projectId: "P1", platform: "META", accountId: "act_1",
    mappings: [
      { canonicalField: "date" as const, sourceColumn: "Day", required: true },
      { canonicalField: "entityLevel" as const, sourceColumn: "Level", required: true },
      { canonicalField: "campaignId" as const, sourceColumn: "Campaign", required: true },
      { canonicalField: "adsetId" as const, sourceColumn: "Adset", required: false },
      { canonicalField: "adId" as const, sourceColumn: "Ad", required: false },
      { canonicalField: "entityName" as const, sourceColumn: "Name", required: true },
      { canonicalField: "spend" as const, sourceColumn: "Cost", required: true },
      { canonicalField: "result" as const, sourceColumn: "Leads", required: false },
      { canonicalField: "sourceUpdatedAt" as const, sourceColumn: "Updated", required: true }
    ],
    metricMappings: [{ metricKey: "bookedAppointment", sourceColumn: "Bookings" }],
    dimensionMappings: [{ dimensionKey: "objective", sourceColumn: "Objective" }]
  };

  it("maps a brand-specific export into the canonical contract without inventing missing metrics", () => {
    const result = normalizeRows([{ Day: "2026-07-20", Level: "Ad", Campaign: "C1", Adset: "AS1", Ad: "A1", Name: "Creative", Cost: "1,000", Leads: "", Bookings: "3", Objective: "LEADS", Updated: "2026-07-20T07:00:00+07:00" }], baseContext);
    expect(result.errors).toHaveLength(0);
    expect(result.facts[0].spend).toBe(1000);
    expect(result.facts[0].result).toBeNull();
    expect(result.facts[0].metrics.bookedAppointment).toBe(3);
    expect(result.facts[0].objective).toBe("LEADS");
  });

  it("deduplicates rows with duplicate sourceRowKey and reports errors", () => {
    const row1 = { Day: "2026-07-20", Level: "Ad", Campaign: "C1", Adset: "AS1", Ad: "A1", Name: "Creative 1", Cost: "100", Updated: "2026-07-20T07:00:00+07:00" };
    const row2 = { Day: "2026-07-20", Level: "Ad", Campaign: "C1", Adset: "AS1", Ad: "A1", Name: "Creative 1", Cost: "100", Updated: "2026-07-20T07:00:00+07:00" };
    const row3 = { Day: "2026-07-20", Level: "Ad", Campaign: "C1", Adset: "AS1", Ad: "A2", Name: "Creative 2", Cost: "200", Updated: "2026-07-20T07:00:00+07:00" };

    const result = normalizeRows([row1, row2, row3], baseContext);

    // Duplicate rows with key P1|2026-07-20||AD|C1|AS1|A1 are removed from facts
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].adId).toBe("A2");

    const dupErrors = result.errors.filter((e) => e.code === "DUPLICATE_SOURCE_KEY_IN_IMPORT");
    expect(dupErrors.length).toBeGreaterThan(0);
  });

  it("produces an error when a required field is missing", () => {
    const invalidRow = { Day: "", Level: "Ad", Campaign: "C1", Name: "Creative 1", Cost: "100", Updated: "2026-07-20T07:00:00+07:00" };

    const result = normalizeRows([invalidRow], baseContext);
    const reqErrors = result.errors.filter((e) => e.code === "REQUIRED_VALUE_MISSING");
    expect(reqErrors.length).toBeGreaterThan(0);
    expect(reqErrors[0].field).toBe("date");
  });

  it("normalizes date-only and space-separated date strings to UTC date ISO without timezone shift", () => {
    const result1 = normalizeRows([{ Day: "2026-07-20", Level: "Ad", Campaign: "C1", Name: "Ad 1", Cost: "100", Updated: "2026-07-20T07:00:00+07:00" }], baseContext);
    expect(result1.facts[0].date).toBe("2026-07-20");

    const result2 = normalizeRows([{ Day: "2026-07-20 00:00", Level: "Ad", Campaign: "C1", Name: "Ad 1", Cost: "100", Updated: "2026-07-20T07:00:00+07:00" }], baseContext);
    expect(result2.facts[0].date).toBe("2026-07-20");
  });
});
