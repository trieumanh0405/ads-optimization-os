"use client";

import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  FileCheck2,
  Plus,
  ShieldAlert,
  Target
} from "lucide-react";
import type { LocalProject, WorkspaceState, WorkspaceView } from "@/product/types";
import { formatNumber, latestRun } from "../helpers/format-utils";

export type OverviewViewProps = {
  workspace: WorkspaceState;
  project: LocalProject | null;
  onProjectChange: (project: LocalProject) => void;
  onViewChange: (view: WorkspaceView) => void;
  toast: (message: string, tone?: "info" | "success" | "error") => void;
  onCreate?: () => void;
  onSelect?: (id: string) => void;
  onNavigate?: (view: WorkspaceView) => void;
};

export function OverviewView({
  workspace,
  project,
  onProjectChange,
  onViewChange,
  toast: _toast,
  onCreate,
  onSelect,
  onNavigate
}: OverviewViewProps) {
  const handleCreate = onCreate ?? (() => onViewChange("PROJECT_SETUP"));
  const handleNavigate = onNavigate ?? onViewChange;
  const handleSelect = (item: LocalProject) => {
    if (onSelect) {
      onSelect(item.config.projectId);
    }
    onProjectChange(item);
  };

  if (!workspace.projects.length) {
    return (
      <section className="emptyHero">
        <span className="heroIcon"><Target size={30} /></span>
        <span className="sectionKicker">BẮT ĐẦU TỪ PROJECT THẬT</span>
        <h2>Tạo brand, chọn KPI, import data và chạy rule engine</h2>
        <p>Không có sample data giả lập. Project đầu tiên sẽ sinh bộ metric, lookback và rule mặc định để bạn chỉnh theo SOP của team.</p>
        <button className="primaryAction large" onClick={handleCreate}><Plus size={18} /> Tạo project đầu tiên</button>
        <div className="flowSteps">
          {[
            ["01", "Project & KPI", "Chọn CPL, CPQL, CPA, ROAS hoặc KPI chuẩn khác."],
            ["02", "Import raw data", "Map cột nguồn và chặn lỗi trước khi tính."],
            ["03", "Run engine", "Today · 3D · 7D · Lifetime + parent context."],
            ["04", "Action queue", "Duyệt, thực hiện và giữ audit log."]
          ].map(([number, title, body]) => (
            <div key={number}><b>{number}</b><strong>{title}</strong><span>{body}</span></div>
          ))}
        </div>
      </section>
    );
  }

  const projects = workspace.projects;
  const totalFacts = projects.reduce((sum, item) => sum + item.facts.length, 0);
  const totalPending = projects.reduce((sum, item) => sum + item.actions.filter((action) => action.approvalStatus === "PENDING").length, 0);
  const completedToday = projects.reduce((sum, item) => sum + item.actions.filter((action) =>
    action.approvalStatus === "DONE" && action.executedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)
  ).length, 0);
  const active = project ?? projects[0];
  const activeRun = latestRun(active);
  const steps = [
    { label: "Project & KPI", done: Boolean(active.config.primaryMetricKey && active.config.target), view: "PROJECT_SETUP" as const },
    { label: "Raw data", done: active.facts.length > 0, view: "DATA_IMPORT" as const },
    { label: "Rules", done: active.rules.some((rule) => rule.enabled), view: "RULES" as const },
    { label: "Engine run", done: active.runs.length > 0, view: "DECISIONS" as const },
    { label: "Action reviewed", done: active.actions.some((action) => action.approvalStatus !== "PENDING"), view: "ACTIONS" as const }
  ];

  return (
    <div className="viewStack">
      <section className="metricStrip">
        <article><span className="metricIcon blue"><Archive size={18} /></span><div><small>Projects</small><strong>{projects.length}</strong><em>brand workspaces</em></div></article>
        <article><span className="metricIcon teal"><Database size={18} /></span><div><small>Fact rows</small><strong>{totalFacts.toLocaleString("vi-VN")}</strong><em>normalized</em></div></article>
        <article><span className="metricIcon amber"><Clock3 size={18} /></span><div><small>Pending actions</small><strong>{totalPending}</strong><em>cần review</em></div></article>
        <article><span className="metricIcon green"><CheckCircle2 size={18} /></span><div><small>Done today</small><strong>{completedToday}</strong><em>đã thực hiện</em></div></article>
      </section>

      <div className="overviewGrid">
        <section className="sectionCard">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">PROJECT REGISTRY</span>
              <h2>Các brand đang vận hành</h2>
            </div>
            <button className="iconAction" onClick={handleCreate} aria-label="Tạo project"><Plus size={18} /></button>
          </div>
          <div className="projectRows">
            {projects.map((item) => {
              const itemRun = latestRun(item);
              const pending = item.actions.filter((action) => action.approvalStatus === "PENDING").length;
              return (
                <button key={item.config.projectId} className={item.config.projectId === active.config.projectId ? "active" : ""} onClick={() => handleSelect(item)}>
                  <span className="projectAvatar">{item.config.projectName.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{item.config.projectName}</strong><small>{item.config.platform} · {item.config.accountId}</small></span>
                  <span className="projectKpi"><small>{item.config.primaryMetricKey}</small><strong>{formatNumber(item.config.target, item.config.currency)}</strong></span>
                  <span className={`statusBadge ${itemRun?.qc.status === "FAIL" ? "danger" : itemRun ? "success" : "neutral"}`}>{itemRun ? `QC ${itemRun.qc.status}` : "Not run"}</span>
                  <span className="pendingBadge">{pending}</span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="sectionCard">
          <div className="sectionHeader">
            <div>
              <span className="sectionKicker">OPERATING CHECKLIST</span>
              <h2>{active.config.projectName}</h2>
              <p>{steps.filter((item) => item.done).length}/{steps.length} bước đã sẵn sàng.</p>
            </div>
          </div>
          <div className="checklist">
            {steps.map((step, index) => (
              <button key={step.label} onClick={() => handleNavigate(step.view)}>
                <span className={step.done ? "done" : ""}>{step.done ? <CheckCircle2 size={17} /> : index + 1}</span>
                <strong>{step.label}</strong>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          {activeRun?.qc.issues.length ? (
            <div className="qcCallout">
              <ShieldAlert size={19} />
              <div><strong>{activeRun.qc.issues[0].code}</strong><span>{activeRun.qc.issues[0].message}</span></div>
            </div>
          ) : (
            <div className="qcCallout success">
              <FileCheck2 size={19} />
              <div><strong>{activeRun ? "Engine run gần nhất hợp lệ" : "Sẵn sàng import data"}</strong><span>{activeRun ? new Date(activeRun.runAt).toLocaleString("vi-VN") : "Không dùng số demo trong workspace."}</span></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
