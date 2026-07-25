import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PLAYBOOKS,
  basePerformancePlaybook,
  compilePlaybooks,
  findBuiltInPlaybooks,
  missingPlaybookMetrics
} from "./playbooks";

describe("ads analysis playbooks", () => {
  it("ships the two Noti playbooks and Panasonic case guardrails", () => {
    expect(BUILT_IN_PLAYBOOKS.map((item) => item.id)).toEqual([
      "noti-performance-v1",
      "noti-content-funnel-v1",
      "panasonic-vn-case-v1"
    ]);
  });

  it("compiles only selected playbooks and preserves the advisory boundary", () => {
    const selected = findBuiltInPlaybooks(["noti-performance-v1"]);
    const prompt = compilePlaybooks([basePerformancePlaybook, ...selected]);
    expect(prompt).toContain("noti-performance-v1");
    expect(prompt).not.toContain("panasonic-vn-case-v1");
    expect(prompt).toContain("Deterministic actions stay authoritative");
  });

  it("declares required metrics that are absent or null", () => {
    const missing = missingPlaybookMetrics(
      [BUILT_IN_PLAYBOOKS[0]],
      { spend: 100, impressions: null }
    );
    expect(missing["noti-performance-v1"]).toEqual(["impressions"]);
  });
});
