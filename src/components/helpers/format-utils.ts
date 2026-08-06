import type { ActionRecord } from "@/core/actions";
import type { LocalProject, OptimizationRun, WorkspaceState } from "@/product/types";

// formatNumber - formats numbers with vi-VN locale
export function formatNumber(value: number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  if (currency) return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2
  }).format(value);
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}

// actionLabel - returns Vietnamese labels for action codes
export function actionLabel(action: ActionRecord["recommendedAction"]): string {
  return {
    PENDING_DATA: "Chờ dữ liệu",
    KEEP: "Giữ",
    TURN_OFF: "Tắt",
    DECREASE_BUDGET: "Giảm budget",
    INCREASE_BUDGET: "Tăng budget",
    REVIEW_MANUALLY: "Review thủ công"
  }[action];
}

// latestRun - gets most recent optimization run
export function latestRun(project: LocalProject): OptimizationRun | null {
  return [...project.runs].sort((a, b) => b.runAt.localeCompare(a.runAt))[0] ?? null;
}

// upsertProject - immutable state helper
export function upsertProject(state: WorkspaceState, project: LocalProject): WorkspaceState {
  return {
    ...state,
    projects: state.projects.map((item) => item.config.projectId === project.config.projectId ? project : item)
  };
}
