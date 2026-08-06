"use client";

import { useRef } from "react";
import {
  AlertTriangle, CheckCircle2, Download, Menu, Plus, Upload, UsersRound, X
} from "lucide-react";
import type { LocalProject } from "@/product/types";

export type WorkspaceTopbarProps = {
  project: LocalProject | null;
  projects: LocalProject[];
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onMobileNavToggle: () => void;
  isTeamMode: boolean;
  toast: { message: string; tone: string } | null;
  onExportAll?: () => void;
  onImportFile?: (file: File) => void;
  onShowTeamAccess?: () => void;
  userRole?: "admin" | "user";
  onCloseToast?: () => void;
};

export function WorkspaceTopbar({
  project,
  projects,
  onProjectChange,
  onCreateProject,
  onMobileNavToggle,
  isTeamMode,
  toast,
  onExportAll,
  onImportFile,
  onShowTeamAccess,
  userRole,
  onCloseToast
}: WorkspaceTopbarProps) {
  const importWorkspaceInput = useRef<HTMLInputElement>(null);

  return (
    <>
      <header className="productTopbar">
        <button className="mobileMenu" onClick={onMobileNavToggle} aria-label="Mở menu">
          <Menu size={20} />
        </button>
        <label className="projectSelect">
          <span>{project?.config.projectName.slice(0, 2).toUpperCase() || "—"}</span>
          <div>
            <small>PROJECT / BRAND</small>
            <select
              value={project?.config.projectId ?? ""}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              <option value="">Chọn project</option>
              {projects.map((item) => (
                <option key={item.config.projectId} value={item.config.projectId}>
                  {item.config.projectName}
                </option>
              ))}
            </select>
          </div>
        </label>
        <div className="topbarActions">
          {onExportAll && (
            <button
              className="secondaryAction"
              title="Tải bản sao lưu cấu hình và dữ liệu; không chứa API key"
              onClick={onExportAll}
            >
              <Download size={16} /> Sao lưu JSON
            </button>
          )}
          {!isTeamMode && onImportFile && (
            <button
              className="secondaryAction"
              title="Khôi phục Browser workspace từ file JSON đã sao lưu"
              onClick={() => importWorkspaceInput.current?.click()}
            >
              <Upload size={16} /> Khôi phục JSON
            </button>
          )}
          {isTeamMode && userRole === "admin" && onShowTeamAccess && (
            <button className="secondaryAction" onClick={onShowTeamAccess}>
              <UsersRound size={16} /> Team
            </button>
          )}
          <button className="primaryAction" onClick={onCreateProject}>
            <Plus size={16} /> Project mới
          </button>
          {!isTeamMode && onImportFile && (
            <input
              ref={importWorkspaceInput}
              className="visuallyHidden"
              type="file"
              accept=".json,application/json"
              onChange={(event) => event.target.files?.[0] && onImportFile(event.target.files[0])}
            />
          )}
        </div>
      </header>

      {toast && (
        <div className={`appToast ${toast.tone}`} role="status" aria-live="polite">
          {toast.tone === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          {onCloseToast && (
            <button onClick={onCloseToast} aria-label="Đóng">
              <X size={16} />
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default WorkspaceTopbar;
