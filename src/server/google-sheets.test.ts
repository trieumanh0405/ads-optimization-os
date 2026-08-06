import { describe, expect, it } from "vitest";
import { mappingsForGoogleSync, rowsFromGoogleValues, spreadsheetIdFromInput } from "./google-sheets";

describe("Google Sheets connector", () => {
  it("extracts an ID from a shared Google Sheets URL or a raw ID", () => {
    expect(spreadsheetIdFromInput("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(spreadsheetIdFromInput("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  });

  it("uses a configured header row and skips empty rows", () => {
    const output = rowsFromGoogleValues([["Report title"], ["Day", "Amount spent", "Leads"], ["2026-07-28", "100000", "4"], ["", "", ""]], 2);
    expect(output.headers).toEqual(["Day", "Amount spent", "Leads"]);
    expect(output.rows).toEqual([{ Day: "2026-07-28", "Amount spent": "100000", Leads: "4" }]);
    expect(output.truncated).toBe(false);
  });

  it("ignores formula-only padding below the real ads export", () => {
    const output = rowsFromGoogleValues([
      ["Day", "Campaign Id", "Ad Id", "Amount Spent", "Calculated Spend"],
      ["2026-07-29", "camp-1", "ad-1", "100", "110"],
      ["", "", "", "", "0"],
      ["", "", "", "", "0"]
    ], 1);
    expect(output.rows).toHaveLength(1);
    expect(output.rows[0]?.["Ad Id"]).toBe("ad-1");
  });

  it("keeps malformed anchored rows so import QC can report them", () => {
    const output = rowsFromGoogleValues([
      ["Day", "Campaign Id", "Ad Id", "Amount Spent"],
      ["2026-07-29", "camp-1", "", "100"]
    ], 1);
    expect(output.rows).toHaveLength(1);
  });

  it("refreshes a default source timestamp on every connector sync", () => {
    const mappings = mappingsForGoogleSync([
      { canonicalField: "sourceUpdatedAt", sourceColumn: "__DEFAULT__", required: true, defaultValue: "2026-07-29T00:00:00.000Z" },
      { canonicalField: "date", sourceColumn: "Day", required: true }
    ], "2026-07-30T05:00:00.000Z");
    expect(mappings[0].defaultValue).toBe("2026-07-30T05:00:00.000Z");
    expect(mappings[1]).toEqual({ canonicalField: "date", sourceColumn: "Day", required: true });
  });

  it("keeps an explicit source timestamp column unchanged", () => {
    const mappings = mappingsForGoogleSync([
      { canonicalField: "sourceUpdatedAt", sourceColumn: "Updated At", required: true }
    ], "2026-07-30T05:00:00.000Z");
    expect(mappings[0]).toEqual({ canonicalField: "sourceUpdatedAt", sourceColumn: "Updated At", required: true });
  });
});
