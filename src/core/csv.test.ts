import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("CSV ingestion", () => {
  it("handles quoted names, commas and CRLF", () => {
    const rows = parseCsv('ID,Name,Spend\r\n1,"Campaign, HCM","1,000"\r\n');
    expect(rows[0]).toEqual({ ID: "1", Name: "Campaign, HCM", Spend: "1,000" });
  });
  it("rejects duplicate headers", () => {
    expect(() => parseCsv("ID,ID\n1,2")).toThrow("CSV_HEADERS_INVALID_OR_DUPLICATE");
  });
});
