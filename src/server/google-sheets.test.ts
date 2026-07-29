import { describe, expect, it } from "vitest";
import { rowsFromGoogleValues, spreadsheetIdFromInput } from "./google-sheets";

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
});
