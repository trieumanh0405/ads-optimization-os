import { describe, expect, it } from "vitest";
import { causeLabel, readEvidence } from "./diagnostics";

const window = (id: string, spend: number, result: number | null) =>
  ({ id, spend, result, rowCount: 1 });

describe("readEvidence", () => {
  it("calls an entity that spent money with zero results a measurement problem", () => {
    const reading = readEvidence([
      window("TODAY", 3780, 0),
      window("D3", 11340, 0),
      window("D7", 26460, 0)
    ]);
    expect(reading.cause).toBe("SPENT_NO_RESULT");
    expect(reading.spend).toBe(26460);
  });

  it("separates an entity that never spent from one that spent and failed", () => {
    expect(readEvidence([window("TODAY", 0, 0), window("D3", 0, 0)]).cause).toBe("NO_SPEND");
  });

  it("treats a producing entity below the minimum as thin, not mismeasured", () => {
    const reading = readEvidence([window("TODAY", 4000, 1), window("D3", 12000, 3)]);
    expect(reading.cause).toBe("THIN_EVIDENCE");
    expect(reading.results).toBe(3);
  });

  it("reads the widest window, so a quiet today does not mask a busy week", () => {
    const reading = readEvidence([window("TODAY", 0, 0), window("D7", 90000, 0)]);
    expect(reading.cause).toBe("SPENT_NO_RESULT");
    expect(reading.spend).toBe(90000);
  });

  it("falls back to thin evidence when a run carried no window detail", () => {
    expect(readEvidence(undefined).cause).toBe("THIN_EVIDENCE");
    expect(readEvidence([]).cause).toBe("THIN_EVIDENCE");
  });

  it("names the scope's own event in the sentence it hands the operator", () => {
    expect(causeLabel("SPENT_NO_RESULT", "Page Like")).toContain("Page Like");
    expect(causeLabel("SPENT_NO_RESULT", "Tin nhắn")).toContain("Tin nhắn");
  });
});
