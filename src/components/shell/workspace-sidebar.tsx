"use client";

import {
  BrainCircuit, ClipboardCheck, Cloud, CloudOff, Database, Gauge, History,
  LayoutDashboard, Settings2, SlidersHorizontal, X
} from "lucide-react";
import type { LocalProject, WorkspaceView } from "@/product/types";

export type WorkspaceSidebarProps = {
  currentView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  project: LocalProject | null;
  isTeamMode: boolean;
  mobileNav: boolean;
  onMobileNavClose: () => void;
  operatorName?: string;
  onOperatorNameChange?: (name: string) => void;
  userEmail?: string;
};

export const WORKSPACE_VIEW_LABELS: Record<WorkspaceView, { label: string; description: string }> = {
  OVERVIEW: { label: "Tổng quan", description: "Tình trạng project và bước vận hành tiếp theo" },
  PROJECT_SETUP: { label: "Project & KPI", description: "Metric chính, target, lookback và guardrail" },
  DATA_IMPORT: { label: "Data import", description: "Đưa raw data thật vào data contract" },
  RULES: { label: "Rule engine", description: "Thiết lập điều kiện tắt, giữ và tăng đầu tư" },
  DECISIONS: { label: "Decision board", description: "Chạy engine và xem đề xuất theo Campaign · Ad set · Ad" },
  ACTIONS: { label: "Action queue", description: "Duyệt, thực hiện và lưu lịch sử action" },
  AI: { label: "AI diagnostics", description: "Phân tích supporting metrics bằng nhiều model/playbook" },
  RUNS: { label: "Runs & audit", description: "QC, import, run và action log" }
};

export const NAV_ITEMS: Array<{ id: WorkspaceView; icon: typeof LayoutDashboard }> = [
  { id: "OVERVIEW", icon: LayoutDashboard },
  { id: "PROJECT_SETUP", icon: Settings2 },
  { id: "DATA_IMPORT", icon: Database },
  { id: "RULES", icon: SlidersHorizontal },
  { id: "DECISIONS", icon: Gauge },
  { id: "ACTIONS", icon: ClipboardCheck },
  { id: "AI", icon: BrainCircuit },
  { id: "RUNS", icon: History }
];

export function WorkspaceSidebar({
  currentView,
  onViewChange,
  project,
  isTeamMode,
  mobileNav,
  onMobileNavClose,
  operatorName = "",
  onOperatorNameChange,
  userEmail
}: WorkspaceSidebarProps) {
  const pendingCount = project?.actions.filter((item) => item.approvalStatus === "PENDING").length ?? 0;

  return (
    <aside className={`productSidebar ${mobileNav ? "open" : ""}`}>
      <div className="sidebarBrand">
        <span>AO</span>
        <div><strong>ADS OPT OS</strong><small>INTERNAL · V1</small></div>
        <button className="mobileClose" onClick={onMobileNavClose} aria-label="Đóng menu"><X size={18} /></button>
      </div>
      <nav aria-label="Điều hướng chính">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const disabled = !project && item.id !== "OVERVIEW";
          return (
            <button
              key={item.id}
              className={currentView === item.id ? "active" : ""}
              disabled={disabled}
              onClick={() => onViewChange(item.id)}
            >
              <Icon size={18} />
              <span>{WORKSPACE_VIEW_LABELS[item.id].label}</span>
              {item.id === "ACTIONS" && pendingCount > 0 && <b>{pendingCount}</b>}
            </button>
          );
        })}
      </nav>
      <div className="sidebarFoot">
        <span className="localMode">{isTeamMode ? <Cloud size={15} /> : <CloudOff size={15} />}{isTeamMode ? "Team workspace" : "Browser workspace"}</span>
        <small>{isTeamMode ? `${userEmail ? `${userEmail} · ` : ""}Supabase` : "IndexedDB · API key chỉ trong session"}</small>
        <label className="sidebarOperator">
          <span>Operator / reviewer</span>
          <input
            value={operatorName}
            onChange={(event) => onOperatorNameChange?.(event.target.value)}
            placeholder="Tên media buyer"
          />
        </label>
      </div>
    </aside>
  );
}

export default WorkspaceSidebar;
