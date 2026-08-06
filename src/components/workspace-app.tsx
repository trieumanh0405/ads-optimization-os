"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { createProject, EMPTY_WORKSPACE } from "@/product/defaults";
import { downloadText } from "@/product/api";
import { exportWorkspace, importWorkspace, loadWorkspace, saveWorkspace } from "@/product/persistence";
import type { TeamApi } from "@/product/team-api";
import { createTeamApi } from "@/product/team-api";
import { isSupabaseBrowserConfigured, supabaseBrowser } from "@/product/supabase-browser";
import type { LocalProject, ProjectCreateInput, WorkspaceState, WorkspaceView } from "@/product/types";
import { latestRun, upsertProject } from "./helpers/format-utils";
import { CreateProjectDialog } from "./dialogs/create-project-dialog";
import { TeamAccessDialog } from "./dialogs/team-access-dialog";
import { WORKSPACE_VIEW_LABELS, WorkspaceSidebar } from "./shell/workspace-sidebar";
import { WorkspaceTopbar } from "./shell/workspace-topbar";
import { OverviewView } from "./views/overview-view";
import { ProjectSetupView } from "./views/project-setup-view";
import { DecisionBoard, type SourceSyncResponse } from "./views/decision-board";
import { ActionQueue } from "./views/action-queue";
import { RunsAudit } from "./views/runs-audit";
import { DataImporter } from "./data-importer";
import { RuleManager } from "./rule-manager";
import { AiAnalysisPanel } from "./ai-analysis-panel";

type TeamIdentity = { api: TeamApi; email: string; organizationId: string; role: "admin" | "user" };

const defaultCreateInput = (): ProjectCreateInput => ({
  projectName: "",
  platform: "META",
  accountId: "",
  currency: "VND",
  timezone: "Asia/Bangkok",
  startDate: new Date().toISOString().slice(0, 8) + "01",
  primaryMetricKey: "CPL",
  optimizationEventLabel: "Lead",
  target: 100000,
  salesModel: "LANDING_PAGE_OFFLINE_CLOSE",
  trackingConfidence: "UNKNOWN",
  capiStatus: "UNKNOWN"
});

export function WorkspaceApp() {
  return isSupabaseBrowserConfigured() ? <SupabaseTeamEntry /> : <WorkspaceShell />;
}

function SupabaseTeamEntry() {
  const [state, setState] = useState<"loading" | "signed-out" | "onboarding" | "access-required" | "ready" | "error">("loading");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [message, setMessage] = useState("");
  const [identity, setIdentity] = useState<TeamIdentity | null>(null);

  async function resolveSession() {
    const { data } = await supabaseBrowser().auth.getSession();
    const session = data.session;
    if (!session) { setIdentity(null); setState("signed-out"); return; }
    const tentativeApi = createTeamApi(session.access_token, "");
    try {
      const response = await tentativeApi<{ user: { organizationId: string; role: string } }>("/api/me");
      setIdentity({ api: createTeamApi(session.access_token, response.user.organizationId), email: session.user.email ?? "", organizationId: response.user.organizationId, role: response.user.role as "admin" | "user" });
      setState("ready");
    } catch (error) {
      setIdentity(null);
      if (error instanceof Error && error.message.includes("MEMBERSHIP_REQUIRED")) {
        const bootstrap = await tentativeApi<{ bootstrapAllowed: boolean }>("/api/onboarding").catch(() => ({ bootstrapAllowed: false }));
        setState(bootstrap.bootstrapAllowed ? "onboarding" : "access-required");
      } else setState("error");
      setMessage(error instanceof Error ? error.message : "Không thể kết nối Supabase.");
    }
  }

  useEffect(() => {
    resolveSession();
    const { data: listener } = supabaseBrowser().auth.onAuthStateChange(() => { void resolveSession(); });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin }
    });
    setMessage(error ? error.message : "Đã gửi link đăng nhập. Mở email và quay lại tool này.");
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) return setState("signed-out");
    try {
      const api = createTeamApi(data.session.access_token, "");
      await api("/api/onboarding", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName })
      });
      await resolveSession();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không thể tạo organization."); }
  }

  if (state === "ready" && identity) return <WorkspaceShell team={identity} />;
  if (state === "loading") return <main className="loadingScreen"><RefreshCw className="spin" /><strong>Đang kết nối team workspace…</strong></main>;
  if (state === "onboarding") return (
    <main className="loadingScreen"><section className="sectionCard authCard"><h1>Tạo team workspace</h1><p>Tài khoản này chưa thuộc organization nào. Người tạo đầu tiên sẽ là admin.</p>
      <form onSubmit={createOrganization}><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Tên agency / team" required minLength={2} /><button className="primaryAction" type="submit">Tạo organization</button></form>
      {message && <small>{message}</small>}</section></main>
  );
  if (state === "access-required") return (
    <main className="loadingScreen"><section className="sectionCard authCard"><h1>Chờ admin cấp quyền</h1><p>Email này chưa được thêm vào team. Hãy nhờ Admin mở mục <strong>Team</strong>, nhập email và chọn các project bạn được làm việc.</p>
      <button className="secondaryAction" onClick={() => void supabaseBrowser().auth.signOut().then(() => setState("signed-out"))}>Dùng email khác</button>
      {message && <small>{message}</small>}</section></main>
  );
  return (
    <main className="loadingScreen"><section className="sectionCard authCard"><h1>Đăng nhập team workspace</h1><p>Dùng email đã được cấp quyền. Tool gửi magic link, không lưu mật khẩu tại đây.</p>
      <form onSubmit={sendMagicLink}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@agency.com" required /><button className="primaryAction" type="submit">Gửi link đăng nhập</button></form>
      {message && <small>{message}</small>}</section></main>
  );
}

function WorkspaceShell({ team }: { team?: TeamIdentity }) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(structuredClone(EMPTY_WORKSPACE));
  const [hydrated, setHydrated] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showTeamAccess, setShowTeamAccess] = useState(false);
  const [deletableProjectIds, setDeletableProjectIds] = useState<Set<string>>(new Set());
  const [createInput, setCreateInput] = useState<ProjectCreateInput>(defaultCreateInput);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const teamSyncTimers = useRef(new Map<string, number>());
  const activeSourceSyncs = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await loadWorkspace();
      let projects = state.projects;
      let listedProjects: Array<{ projectId: string; canDelete: boolean }> = [];
      if (team) {
        const listed = await team.api<{ projects: Array<{ projectId: string; canDelete: boolean }> }>("/api/projects");
        listedProjects = listed.projects;
        projects = await Promise.all(listed.projects.map(async ({ projectId }) => {
          const result = await team.api<{ project: LocalProject }>(`/api/projects/${encodeURIComponent(projectId)}/workspace`);
          return result.project;
        }));
      }
      if (cancelled) return;
      setDeletableProjectIds(new Set(listedProjects.filter((item) => item.canDelete).map((item) => item.projectId)));
      const hash = window.location.hash.replace("#", "").toUpperCase() as WorkspaceView;
      setWorkspace({
        ...state, projects, activeProjectId: projects.some((item) => item.config.projectId === state.activeProjectId)
          ? state.activeProjectId : projects[0]?.config.projectId ?? null,
        activeView: hash in WORKSPACE_VIEW_LABELS ? hash : state.activeView
      });
      setHydrated(true);
    })().catch((error) => {
      if (!cancelled) { notify(error instanceof Error ? error.message : "TEAM_WORKSPACE_LOAD_FAILED", "error"); setHydrated(true); }
    });
    return () => { cancelled = true; };
  }, [team?.organizationId, team?.role]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => saveWorkspace(workspace), 350);
    return () => window.clearTimeout(timeout);
  }, [workspace, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const project = workspace.projects.find((item) => item.config.projectId === workspace.activeProjectId) ?? null;
  const run = project ? latestRun(project) : null;

  useEffect(() => {
    if (!hydrated || !team || !project) return;
    const source = project.config.dataSource;
    if (source.kind !== "GOOGLE_SHEETS" || !source.autoSyncEnabled || !source.spreadsheetId || !source.sheetName) return;
    const intervalMs = source.syncIntervalMinutes * 60_000;
    const lastSync = source.lastSyncedAt ? Date.parse(source.lastSyncedAt) : Number.NaN;
    const delay = Number.isFinite(lastSync) ? Math.max(5_000, intervalMs - (Date.now() - lastSync)) : 10_000;
    const timeout = window.setTimeout(() => {
      void syncProjectFromSource(project.config.projectId, true);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [hydrated, team?.organizationId, project?.config.projectId, project?.config.dataSource.lastSyncedAt, project?.config.dataSource.autoSyncEnabled, project?.config.dataSource.syncIntervalMinutes]);

  function notify(message: string, tone: "success" | "error" | "info" = "success") {
    setToast({ message, tone: tone === "info" ? "success" : tone });
  }

  async function syncProjectFromSource(projectId: string, silent = false): Promise<SourceSyncResponse | null> {
    if (!team) {
      if (!silent) notify("Auto refresh cần Team workspace kết nối Supabase.", "error");
      return null;
    }
    if (activeSourceSyncs.current.has(projectId)) return null;
    activeSourceSyncs.current.add(projectId);
    try {
      const response = await team.api<SourceSyncResponse>(`/api/projects/${encodeURIComponent(projectId)}/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: !silent })
      });
      setWorkspace((current) => upsertProject(current, response.project));
      if (!silent) notify(response.sync.skipped
        ? "Dữ liệu đã được một thành viên khác refresh trong chu kỳ hiện tại."
        : `Đã refresh ${response.sync.accepted.toLocaleString("vi-VN")} fact rows${response.sync.run ? " và chạy optimization" : ""}.`
      );
      return response;
    } catch (error) {
      notify(error instanceof Error ? error.message : "GOOGLE_SHEETS_SYNC_FAILED", "error");
      return null;
    } finally {
      activeSourceSyncs.current.delete(projectId);
    }
  }

  function setView(view: WorkspaceView) {
    setWorkspace((current) => ({ ...current, activeView: view }));
    window.history.replaceState(null, "", `#${view.toLowerCase()}`);
    setMobileNav(false);
  }

  function updateProject(nextProject: LocalProject, options?: { syncConfig?: boolean }) {
    setWorkspace((current) => upsertProject(current, nextProject));
    if (options?.syncConfig !== false) queueTeamBundle(nextProject);
  }

  function queueTeamBundle(nextProject: LocalProject, immediately = false): Promise<void> {
    if (!team) return Promise.resolve();
    const currentTimer = teamSyncTimers.current.get(nextProject.config.projectId);
    if (currentTimer) window.clearTimeout(currentTimer);
    const sync = () => team.api("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: nextProject.config, metricDefinitions: nextProject.metricDefinitions,
        rules: nextProject.rules, mappings: nextProject.mappings,
        metricMappings: nextProject.metricMappings, dimensionMappings: nextProject.dimensionMappings
      })
    }).then(() => undefined);
    if (immediately) return sync();
    teamSyncTimers.current.set(nextProject.config.projectId, window.setTimeout(() => {
      void sync().catch((error) => notify(error instanceof Error ? error.message : "TEAM_PROJECT_SYNC_FAILED", "error"));
    }, 800));
    return Promise.resolve();
  }

  async function createNewProject() {
    if (!createInput.projectName.trim() || !createInput.accountId.trim() || createInput.target <= 0) {
      return notify("Project name, Account ID và target KPI là bắt buộc.", "error");
    }
    const next = createProject(createInput);
    try {
      await queueTeamBundle(next, true);
    } catch (error) {
      return notify(error instanceof Error ? error.message : "TEAM_PROJECT_CREATE_FAILED", "error");
    }
    setDeletableProjectIds((current) => new Set([...current, next.config.projectId]));
    setWorkspace((current) => ({
      ...current,
      activeProjectId: next.config.projectId,
      activeView: "PROJECT_SETUP",
      projects: [...current.projects, next]
    }));
    setCreateInput(defaultCreateInput());
    setShowCreate(false);
    window.history.replaceState(null, "", "#project_setup");
    notify("Đã tạo project và bộ rule mặc định.");
  }

  async function deleteProject() {
    if (!project || !window.confirm(`Xóa project "${project.config.projectName}"? Dữ liệu import, runs và action queue của project cũng bị xóa. Hãy export backup trước nếu cần.`)) return;
    if (team) {
      try { await team.api(`/api/projects/${encodeURIComponent(project.config.projectId)}`, { method: "DELETE" }); }
      catch (error) { return notify(error instanceof Error ? error.message : "PROJECT_DELETE_FORBIDDEN", "error"); }
    }
    const remaining = workspace.projects.filter((item) => item.config.projectId !== project.config.projectId);
    setDeletableProjectIds((current) => { const next = new Set(current); next.delete(project.config.projectId); return next; });
    setWorkspace((current) => ({
      ...current,
      projects: remaining,
      activeProjectId: remaining[0]?.config.projectId ?? null,
      activeView: "OVERVIEW",
      analyses: current.analyses.filter((item) => item.projectId !== project.config.projectId)
    }));
    notify("Đã xóa project khỏi browser.", "success");
  }

  function exportAll() {
    downloadText(
      `ads-optimization-workspace-${new Date().toISOString().slice(0, 10)}.json`,
      exportWorkspace(workspace)
    );
    notify("Đã export workspace backup.");
  }

  async function importAll(file: File) {
    try {
      const state = importWorkspace(await file.text());
      setWorkspace(state);
      notify(`Đã restore ${state.projects.length} project.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Workspace backup không hợp lệ.", "error");
    }
  }

  if (!hydrated) {
    return (
      <main className="loadingScreen" aria-live="polite">
        <RefreshCw className="spin" />
        <strong>Đang mở Ads Optimization OS…</strong>
      </main>
    );
  }

  return (
    <div className="productShell">
      <a className="skipLink" href="#main-content">Bỏ qua navigation</a>

      <WorkspaceSidebar
        currentView={workspace.activeView}
        onViewChange={setView}
        project={project}
        isTeamMode={Boolean(team)}
        mobileNav={mobileNav}
        onMobileNavClose={() => setMobileNav(false)}
        operatorName={workspace.operatorName}
        onOperatorNameChange={(name) => setWorkspace((current) => ({ ...current, operatorName: name }))}
        userEmail={team?.email}
      />

      <div className="productMain">
        <WorkspaceTopbar
          project={project}
          projects={workspace.projects}
          onProjectChange={(projectId) => setWorkspace((current) => ({ ...current, activeProjectId: projectId || null }))}
          onCreateProject={() => setShowCreate(true)}
          onMobileNavToggle={() => setMobileNav(true)}
          isTeamMode={Boolean(team)}
          toast={toast}
          onExportAll={exportAll}
          onImportFile={importAll}
          onShowTeamAccess={() => setShowTeamAccess(true)}
          userRole={team?.role}
          onCloseToast={() => setToast(null)}
        />

        <main id="main-content" className="pageContent" tabIndex={-1}>
          <div className="pageTitle">
            <div>
              <span className="sectionKicker">{project ? project.config.projectName : "WORKSPACE"}</span>
              <h1>{WORKSPACE_VIEW_LABELS[workspace.activeView].label}</h1>
              <p>{WORKSPACE_VIEW_LABELS[workspace.activeView].description}</p>
            </div>
            {project && (
              <div className="projectHealth">
                <span className={`statusBadge ${run?.qc.status === "FAIL" ? "danger" : run?.qc.status === "WARNING" ? "warning" : "success"}`}>
                  {run?.qc.status === "FAIL" ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  {run ? `QC ${run.qc.status}` : "Chưa chạy engine"}
                </span>
                <span className="statusBadge neutral">{project.facts.length.toLocaleString("vi-VN")} fact rows</span>
              </div>
            )}
          </div>

          {workspace.activeView === "OVERVIEW" && (
            <OverviewView
              workspace={workspace}
              project={project}
              onProjectChange={(p) => setWorkspace((current) => ({ ...current, activeProjectId: p.config.projectId }))}
              onViewChange={setView}
              toast={notify}
              onCreate={() => setShowCreate(true)}
              onSelect={(projectId) => setWorkspace((current) => ({ ...current, activeProjectId: projectId }))}
              onNavigate={setView}
            />
          )}
          {project && workspace.activeView === "PROJECT_SETUP" && (
            <ProjectSetupView
              key={project.config.projectId}
              project={project}
              onProjectChange={updateProject}
              onUpdate={updateProject}
              onDelete={deleteProject}
              canDelete={!team || deletableProjectIds.has(project.config.projectId)}
              notify={notify}
              toast={notify}
            />
          )}
          {project && workspace.activeView === "DATA_IMPORT" && (
            <DataImporter
              key={project.config.projectId}
              project={project}
              onUpdate={updateProject}
              notify={notify}
              teamApi={team?.api}
            />
          )}
          {project && workspace.activeView === "RULES" && (
            <RuleManager
              key={project.config.projectId}
              project={project}
              onUpdate={updateProject}
              notify={notify}
            />
          )}
          {project && workspace.activeView === "DECISIONS" && (
            <DecisionBoard
              key={project.config.projectId}
              project={project}
              onProjectChange={(p) => updateProject(p, { syncConfig: false })}
              teamApi={team?.api ?? null}
              toast={notify}
              onSync={() => syncProjectFromSource(project.config.projectId)}
            />
          )}
          {project && workspace.activeView === "ACTIONS" && (
            <ActionQueue
              key={project.config.projectId}
              project={project}
              onProjectChange={(p) => updateProject(p, { syncConfig: false })}
              operatorName={workspace.operatorName}
              toast={notify}
              teamApi={team?.api ?? null}
            />
          )}
          {project && workspace.activeView === "AI" && (
            <AiAnalysisPanel
              key={project.config.projectId}
              project={project}
              providers={workspace.providers}
              selectedPlaybookIds={workspace.selectedPlaybookIds}
              analyses={workspace.analyses}
              onProvidersChange={(providers) => setWorkspace((current) => ({ ...current, providers }))}
              onPlaybooksChange={(selectedPlaybookIds) => setWorkspace((current) => ({ ...current, selectedPlaybookIds }))}
              onAnalysis={(analysis) => setWorkspace((current) => ({ ...current, analyses: [analysis, ...current.analyses].slice(0, 200) }))}
              notify={notify}
            />
          )}
          {project && workspace.activeView === "RUNS" && (
            <RunsAudit key={project.config.projectId} project={project} />
          )}
        </main>
      </div>

      <CreateProjectDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        createInput={createInput}
        onCreateInputChange={setCreateInput}
        onSubmit={createNewProject}
      />

      {team && (
        <TeamAccessDialog
          open={showTeamAccess && team.role === "admin"}
          onClose={() => setShowTeamAccess(false)}
          teamApi={team.api}
          projects={workspace.projects}
          notify={notify}
        />
      )}
    </div>
  );
}
