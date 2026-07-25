import { describe, expect, it } from "vitest";
import { createProject } from "./defaults";
import { exportWorkspace, importWorkspace } from "./persistence";
import type { WorkspaceState } from "./types";

function project() {
  return createProject({
    projectName: "Persistence test",
    platform: "META",
    accountId: "act_test",
    currency: "VND",
    timezone: "Asia/Bangkok",
    startDate: "2026-07-01",
    primaryMetricKey: "CPL",
    optimizationEventLabel: "Lead",
    target: 100000,
    salesModel: "LANDING_PAGE_OFFLINE_CLOSE",
    trackingConfidence: "UNKNOWN",
    capiStatus: "UNKNOWN"
  });
}

describe("workspace backup contract", () => {
  it("round-trips a valid workspace", () => {
    const item = project();
    const state: WorkspaceState = {
      version: 2,
      operatorName: "Buyer A",
      activeProjectId: item.config.projectId,
      activeView: "RULES",
      projects: [item],
      providers: [],
      selectedPlaybookIds: [],
      analyses: []
    };
    const restored = importWorkspace(exportWorkspace(state));
    expect(restored.operatorName).toBe("Buyer A");
    expect(restored.projects[0].config.projectName).toBe("Persistence test");
  });

  it("migrates an old backup and drops invalid project records", () => {
    const restored = importWorkspace(JSON.stringify({
      format: "ads-optimization-os-workspace",
      state: {
        version: 1,
        activeProjectId: "missing",
        activeView: "NOT_A_VIEW",
        projects: [{ config: { projectId: "broken" } }]
      }
    }));
    expect(restored.operatorName).toBe("Media Buyer");
    expect(restored.projects).toEqual([]);
    expect(restored.activeProjectId).toBeNull();
    expect(restored.activeView).toBe("OVERVIEW");
  });
});
