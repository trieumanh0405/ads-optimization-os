import { describe, expect, it } from "vitest";
import { normalizeRows } from "./normalize";

describe("source mapping", () => {
  it("maps a brand-specific export into the canonical contract without inventing missing metrics", () => {
    const result = normalizeRows([{ Day: "2026-07-20", Level: "Ad", Campaign: "C1", Adset: "AS1", Ad: "A1", Name: "Creative", Cost: "1,000", Leads: "", Bookings: "3", Objective: "LEADS", Updated: "2026-07-20T07:00:00+07:00" }], {
      projectId: "P1", platform: "META", accountId: "act_1",
      mappings: [
        { canonicalField: "date", sourceColumn: "Day", required: true },
        { canonicalField: "entityLevel", sourceColumn: "Level", required: true },
        { canonicalField: "campaignId", sourceColumn: "Campaign", required: true },
        { canonicalField: "adsetId", sourceColumn: "Adset", required: false },
        { canonicalField: "adId", sourceColumn: "Ad", required: false },
        { canonicalField: "entityName", sourceColumn: "Name", required: true },
        { canonicalField: "spend", sourceColumn: "Cost", required: true },
        { canonicalField: "result", sourceColumn: "Leads", required: false },
        { canonicalField: "sourceUpdatedAt", sourceColumn: "Updated", required: true }
      ],
      metricMappings: [{ metricKey: "bookedAppointment", sourceColumn: "Bookings" }],
      dimensionMappings: [{ dimensionKey: "objective", sourceColumn: "Objective" }]
    });
    expect(result.errors).toHaveLength(0);
    expect(result.facts[0].spend).toBe(1000);
    expect(result.facts[0].result).toBeNull();
    expect(result.facts[0].metrics.bookedAppointment).toBe(3);
    expect(result.facts[0].objective).toBe("LEADS");
  });
});
