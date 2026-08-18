"use client";

import { useEffect, useState } from "react";
import {
  BrainCircuit, ChevronDown, Cloud, CloudOff, Database, Gauge, History,
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
  isAdmin?: boolean;
};

export const WORKSPACE_VIEW_LABELS: Record<WorkspaceView, { label: string; description: string }> = {
  OVERVIEW: { label: "Tổng quan", description: "Tình trạng project và bước vận hành tiếp theo" },
  OPERATIONS: {
    label: "Điều hành",
    description: "Kế hoạch, đề xuất và thực thi trên cùng một màn hình"
  },
  PROJECT_SETUP: { label: "Project & KPI", description: "Metric chính, target, lookback và guardrail" },
  DATA_IMPORT: { label: "Data import", description: "Đưa raw data thật vào data contract" },
  RULES: { label: "Rule engine", description: "Thiết lập điều kiện tắt, giữ và tăng đầu tư" },
  AI: { label: "AI diagnostics", description: "Phân tích supporting metrics bằng nhiều model/playbook" },
  RUNS: { label: "Runs & audit", description: "QC, import, run và action log" }
};

export const OPERATOR_NAV_ITEMS: Array<{ id: WorkspaceView; icon: typeof LayoutDashboard }> = [
  { id: "OVERVIEW", icon: LayoutDashboard },
  { id: "OPERATIONS", icon: Gauge },
  { id: "AI", icon: BrainCircuit }
];

export const ADMIN_NAV_ITEMS: Array<{ id: WorkspaceView; icon: typeof LayoutDashboard }> = [
  { id: "PROJECT_SETUP", icon: Settings2 },
  { id: "DATA_IMPORT", icon: Database },
  { id: "RULES", icon: SlidersHorizontal },
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
  userEmail,
  isAdmin = false
}: WorkspaceSidebarProps) {
  const [adminOpen, setAdminOpen] = useState(ADMIN_NAV_ITEMS.some((item) => item.id === currentView));
  const openActions = project?.actions.filter((item) => item.approvalStatus === "PENDING" || item.approvalStatus === "DEFERRED") ?? [];
  const pendingCount = new Set(openActions.map((item) => `${item.scopeId}|${item.entityLevel}|${item.entityId}`)).size;

  useEffect(() => {
    if (ADMIN_NAV_ITEMS.some((item) => item.id === currentView)) setAdminOpen(true);
  }, [currentView]);

  function renderNavItem(item: { id: WorkspaceView; icon: typeof LayoutDashboard }) {
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
        {item.id === "OPERATIONS" && pendingCount > 0 && <b>{pendingCount}</b>}
      </button>
    );
  }

  return (
    <aside className={`productSidebar ${mobileNav ? "open" : ""}`}>
      <div className="sidebarBrand">
        <span>AO</span>
        <div><strong>ADS OPT OS</strong><small>INTERNAL · V1</small></div>
        <button className="mobileClose" onClick={onMobileNavClose} aria-label="Đóng menu"><X size={18} /></button>
      </div>
      <nav aria-label="Điều hướng chính">
        <span className="navSectionLabel">Vận hành</span>
        {OPERATOR_NAV_ITEMS.map(renderNavItem)}
        {isAdmin && (
          <div className="adminNavGroup">
            <button
              type="button"
              className={`navGroupToggle ${adminOpen ? "open" : ""}`}
              onClick={() => setAdminOpen((value) => !value)}
              aria-expanded={adminOpen}
            >
              <Settings2 size={18} />
              <span>Quản trị hệ thống</span>
              <ChevronDown className="navChevron" size={16} />
            </button>
            {adminOpen && <div className="adminNavItems">{ADMIN_NAV_ITEMS.map(renderNavItem)}</div>}
          </div>
        )}
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
