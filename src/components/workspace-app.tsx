"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, Archive, Bot, BrainCircuit, CheckCircle2, ChevronRight,
  CircleDollarSign, ClipboardCheck, Clock3, Cloud, CloudOff, Database, Download, FileCheck2,
  FileSpreadsheet, Gauge, History, LayoutDashboard, ListChecks, Menu, Play,
  Plus, RefreshCw, Save, Settings2, ShieldAlert, SlidersHorizontal, Sparkles,
  Target, Trash2, Upload, UsersRound, X, XCircle
} from "lucide-react";
import type { ActionEvent, ActionRecord, ApprovalStatus } from "@/core/actions";
import { metricDefinitionSchema, type MetricDefinition, type ProjectConfig } from "@/core/schemas";
import { standardMetricLibrary } from "@/core/library";
import { createProject, EMPTY_WORKSPACE, slugify } from "@/product/defaults";
import { apiJson, downloadText } from "@/product/api";
import { exportWorkspace, importWorkspace, loadWorkspace, saveWorkspace } from "@/product/persistence";
import type { TeamApi } from "@/product/team-api";
import { createTeamApi } from "@/product/team-api";
import { isSupabaseBrowserConfigured, supabaseBrowser } from "@/product/supabase-browser";
import type {
  LocalProject, OptimizationRun, ProjectCreateInput, WorkspaceState, WorkspaceView
} from "@/product/types";
import { DataImporter } from "./data-importer";
import { RuleManager } from "./rule-manager";
import { AiAnalysisPanel } from "./ai-analysis-panel";
import { ScopeManager } from "./scope-manager";

type RecommendationView = {
  scopeId: string;
  scopeName: string;
  entityLevel: "CAMPAIGN" | "ADSET" | "AD";
  entityId: string;
  entityName: string;
  currentStatus: string;
  budgetType: string;
  recommendedAction: ActionRecord["recommendedAction"];
  adjustmentPct: number | null;
  reasonCodes: string[];
  matchedRuleIds: string[];
  evidenceWindow: string;
  currentMetric: number | null;
  targetMetric: number;
  weightedAchievement: number | null;
  contextWeightedAchievement: number | null;
  cohortWeightedAchievement: number | null;
  cohortBenchmark: number | null;
  minimumWindowAchievement: number | null;
  trendRatio: number | null;
  redFlagWindowIds: string[];
  evaluatedValue: number | null;
  confidence: number;
  executionPhase: number;
  windowMetrics?: Array<{
    id: string;
    label: string;
    role: string;
    includeInScore: boolean;
    start: string;
    endExclusive: string;
    value: number | null;
    achievement: number | null;
    spend: number;
    result: number | null;
    rowCount: number;
  }>;
};

type SourceSyncResponse = {
  sync: { syncedAt: string; status: "SUCCESS" | "PARTIAL"; accepted: number; rejected: number; latestDataDate: string | null; run: OptimizationRun | null; skipped?: boolean };
  project: LocalProject;
};

const viewMeta: Record<WorkspaceView, { label: string; description: string }> = {
  OVERVIEW: { label: "Tổng quan", description: "Tình trạng project và bước vận hành tiếp theo" },
  PROJECT_SETUP: { label: "Project & KPI", description: "Metric chính, target, lookback và guardrail" },
  DATA_IMPORT: { label: "Data import", description: "Đưa raw data thật vào data contract" },
  RULES: { label: "Rule engine", description: "Thiết lập điều kiện tắt, giữ và tăng đầu tư" },
  DECISIONS: { label: "Decision board", description: "Chạy engine và xem đề xuất theo Campaign · Ad set · Ad" },
  ACTIONS: { label: "Action queue", description: "Duyệt, thực hiện và lưu lịch sử action" },
  AI: { label: "AI diagnostics", description: "Phân tích supporting metrics bằng nhiều model/playbook" },
  RUNS: { label: "Runs & audit", description: "QC, import, run và action log" }
};

const navItems: Array<{ id: WorkspaceView; icon: typeof LayoutDashboard }> = [
  { id: "OVERVIEW", icon: LayoutDashboard },
  { id: "PROJECT_SETUP", icon: Settings2 },
  { id: "DATA_IMPORT", icon: Database },
  { id: "RULES", icon: SlidersHorizontal },
  { id: "DECISIONS", icon: Gauge },
  { id: "ACTIONS", icon: ClipboardCheck },
  { id: "AI", icon: BrainCircuit },
  { id: "RUNS", icon: History }
];

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

function formatNumber(value: number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  if (currency) return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2
  }).format(value);
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}

function actionLabel(action: ActionRecord["recommendedAction"]): string {
  return {
    PENDING_DATA: "Chờ dữ liệu",
    KEEP: "Giữ",
    TURN_OFF: "Tắt",
    DECREASE_BUDGET: "Giảm budget",
    INCREASE_BUDGET: "Tăng budget",
    REVIEW_MANUALLY: "Review thủ công"
  }[action];
}

function latestRun(project: LocalProject): OptimizationRun | null {
  return [...project.runs].sort((a, b) => b.runAt.localeCompare(a.runAt))[0] ?? null;
}

function upsertProject(state: WorkspaceState, project: LocalProject): WorkspaceState {
  return {
    ...state,
    projects: state.projects.map((item) => item.config.projectId === project.config.projectId ? project : item)
  };
}

type TeamIdentity = { api: TeamApi; email: string; organizationId: string; role: "admin" | "user" };
type TeamMemberView = { userId: string; email: string; role: "admin" | "user"; projectIds: string[] };

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
  const importWorkspaceInput = useRef<HTMLInputElement>(null);
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
        activeView: hash in viewMeta ? hash : state.activeView
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
  const pendingCount = project?.actions.filter((item) => item.approvalStatus === "PENDING").length ?? 0;

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

  function notify(message: string, tone: "success" | "error" = "success") {
    setToast({ message, tone });
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
      <aside className={`productSidebar ${mobileNav ? "open" : ""}`}>
        <div className="sidebarBrand">
          <span>AO</span>
          <div><strong>ADS OPT OS</strong><small>INTERNAL · V1</small></div>
          <button className="mobileClose" onClick={() => setMobileNav(false)} aria-label="Đóng menu"><X size={18} /></button>
        </div>
        <nav aria-label="Điều hướng chính">
          {navItems.map((item) => {
            const Icon = item.icon;
            const disabled = !project && item.id !== "OVERVIEW";
            return (
              <button
                key={item.id}
                className={workspace.activeView === item.id ? "active" : ""}
                disabled={disabled}
                onClick={() => setView(item.id)}
              >
                <Icon size={18} />
                <span>{viewMeta[item.id].label}</span>
                {item.id === "ACTIONS" && pendingCount > 0 && <b>{pendingCount}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebarFoot">
          <span className="localMode">{team ? <Cloud size={15} /> : <CloudOff size={15} />}{team ? "Team workspace" : "Browser workspace"}</span>
          <small>{team ? `${team.email} · Supabase` : "IndexedDB · API key chỉ trong session"}</small>
          <label className="sidebarOperator">
            <span>Operator / reviewer</span>
            <input
              value={workspace.operatorName}
              onChange={(event) => setWorkspace((current) => ({ ...current, operatorName: event.target.value }))}
              placeholder="Tên media buyer"
            />
          </label>
        </div>
      </aside>

      <div className="productMain">
        <header className="productTopbar">
          <button className="mobileMenu" onClick={() => setMobileNav(true)} aria-label="Mở menu"><Menu size={20} /></button>
          <label className="projectSelect">
            <span>{project?.config.projectName.slice(0, 2).toUpperCase() || "—"}</span>
            <div>
              <small>PROJECT / BRAND</small>
              <select
                value={workspace.activeProjectId ?? ""}
                onChange={(event) => setWorkspace((current) => ({ ...current, activeProjectId: event.target.value || null }))}
              >
                <option value="">Chọn project</option>
                {workspace.projects.map((item) => (
                  <option key={item.config.projectId} value={item.config.projectId}>{item.config.projectName}</option>
                ))}
              </select>
            </div>
          </label>
          <div className="topbarActions">
            <button className="secondaryAction" title="Tải bản sao lưu cấu hình và dữ liệu; không chứa API key" onClick={exportAll}><Download size={16} /> Sao lưu JSON</button>
            {!team && <button className="secondaryAction" title="Khôi phục Browser workspace từ file JSON đã sao lưu" onClick={() => importWorkspaceInput.current?.click()}><Upload size={16} /> Khôi phục JSON</button>}
            {team?.role === "admin" && <button className="secondaryAction" onClick={() => setShowTeamAccess(true)}><UsersRound size={16} /> Team</button>}
            <button className="primaryAction" onClick={() => setShowCreate(true)}><Plus size={16} /> Project mới</button>
            <input
              ref={importWorkspaceInput}
              className="visuallyHidden"
              type="file"
              accept=".json,application/json"
              onChange={(event) => event.target.files?.[0] && importAll(event.target.files[0])}
            />
          </div>
        </header>

        <main id="main-content" className="pageContent" tabIndex={-1}>
          <div className="pageTitle">
            <div>
              <span className="sectionKicker">{project ? project.config.projectName : "WORKSPACE"}</span>
              <h1>{viewMeta[workspace.activeView].label}</h1>
              <p>{viewMeta[workspace.activeView].description}</p>
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
              onCreate={() => setShowCreate(true)}
              onSelect={(projectId) => setWorkspace((current) => ({ ...current, activeProjectId: projectId }))}
              onNavigate={setView}
            />
          )}
          {project && workspace.activeView === "PROJECT_SETUP" && (
            <ProjectSetupView key={project.config.projectId} project={project} onUpdate={updateProject} onDelete={deleteProject} canDelete={!team || deletableProjectIds.has(project.config.projectId)} notify={notify} />
          )}
          {project && workspace.activeView === "DATA_IMPORT" && (
            <DataImporter key={project.config.projectId} project={project} onUpdate={updateProject} notify={notify} teamApi={team?.api} />
          )}
          {project && workspace.activeView === "RULES" && (
            <RuleManager key={project.config.projectId} project={project} onUpdate={updateProject} notify={notify} />
          )}
          {project && workspace.activeView === "DECISIONS" && (
            <DecisionBoard key={project.config.projectId} project={project} onUpdate={updateProject} notify={notify} teamApi={team?.api} onSync={() => syncProjectFromSource(project.config.projectId)} />
          )}
          {project && workspace.activeView === "ACTIONS" && (
            <ActionQueue key={project.config.projectId} project={project} operatorName={workspace.operatorName} onUpdate={updateProject} notify={notify} teamApi={team?.api} />
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
          {project && workspace.activeView === "RUNS" && <RunsAudit key={project.config.projectId} project={project} />}
        </main>
      </div>

      {showCreate && (
        <CreateProjectDialog
          input={createInput}
          onChange={setCreateInput}
          onClose={() => setShowCreate(false)}
          onCreate={createNewProject}
        />
      )}
      {showTeamAccess && team?.role === "admin" && (
        <TeamAccessDialog team={team} projects={workspace.projects} onClose={() => setShowTeamAccess(false)} notify={notify} />
      )}
      {toast && (
        <div className={`appToast ${toast.tone}`} role="status" aria-live="polite">
          {toast.tone === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Đóng"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function OverviewView({
  workspace,
  project,
  onCreate,
  onSelect,
  onNavigate
}: {
  workspace: WorkspaceState;
  project: LocalProject | null;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onNavigate: (view: WorkspaceView) => void;
}) {
  if (!workspace.projects.length) {
    return (
      <section className="emptyHero">
        <span className="heroIcon"><Target size={30} /></span>
        <span className="sectionKicker">BẮT ĐẦU TỪ PROJECT THẬT</span>
        <h2>Tạo brand, chọn KPI, import data và chạy rule engine</h2>
        <p>Không có sample data giả lập. Project đầu tiên sẽ sinh bộ metric, lookback và rule mặc định để bạn chỉnh theo SOP của team.</p>
        <button className="primaryAction large" onClick={onCreate}><Plus size={18} /> Tạo project đầu tiên</button>
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
            <button className="iconAction" onClick={onCreate} aria-label="Tạo project"><Plus size={18} /></button>
          </div>
          <div className="projectRows">
            {projects.map((item) => {
              const itemRun = latestRun(item);
              const pending = item.actions.filter((action) => action.approvalStatus === "PENDING").length;
              return (
                <button key={item.config.projectId} className={item.config.projectId === active.config.projectId ? "active" : ""} onClick={() => onSelect(item.config.projectId)}>
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
              <button key={step.label} onClick={() => onNavigate(step.view)}>
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

function CreateProjectDialog({
  input,
  onChange,
  onClose,
  onCreate
}: {
  input: ProjectCreateInput;
  onChange: (value: ProjectCreateInput) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  function patch<K extends keyof ProjectCreateInput>(key: K, value: ProjectCreateInput[K]) {
    onChange({ ...input, [key]: value });
  }
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="productModal wideModal" role="dialog" aria-modal="true" aria-labelledby="create-project-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalTitle">
          <div><span className="sectionKicker">NEW BRAND WORKSPACE</span><h2 id="create-project-title">Tạo project</h2><p>Thông tin này tạo config, metric và rule set version 1.</p></div>
          <button className="iconAction" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <div className="formGrid">
          <label>Project / Brand name *
            <input autoFocus value={input.projectName} onChange={(event) => patch("projectName", event.target.value)} placeholder="BVIS · Lead Gen 2026" />
          </label>
          <label>Platform
            <select value={input.platform} onChange={(event) => patch("platform", event.target.value)}>
              <option value="META">Meta Ads</option>
              <option value="TIKTOK">TikTok Ads</option>
              <option value="GOOGLE">Google Ads</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>Ad account ID *
            <input value={input.accountId} onChange={(event) => patch("accountId", event.target.value)} placeholder="act_123456789" />
          </label>
          <label>Project start date
            <input type="date" value={input.startDate} onChange={(event) => patch("startDate", event.target.value)} />
          </label>
          <label>Primary KPI
            <select value={input.primaryMetricKey} onChange={(event) => patch("primaryMetricKey", event.target.value)}>
              <option value="CPL">CPL · Cost per lead</option>
              <option value="CPQL">CPQL · Cost per qualified lead</option>
              <option value="CPA">CPA · Cost per acquisition</option>
              <option value="ROAS">ROAS</option>
              <option value="CTR">CTR</option>
              <option value="CPC">CPC</option>
              <option value="CVR">CVR</option>
              <option value="CPM">CPM</option>
            </select>
          </label>
          <label>Target KPI *
            <input type="number" min="0" value={input.target} onChange={(event) => patch("target", Number(event.target.value))} />
          </label>
          <label>Result nghĩa là
            <input value={input.optimizationEventLabel} onChange={(event) => patch("optimizationEventLabel", event.target.value)} placeholder="Lead / Message / Purchase / Booking" />
          </label>
          <label>Currency
            <select value={input.currency} onChange={(event) => patch("currency", event.target.value)}>
              <option value="VND">VND</option>
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
              <option value="THB">THB</option>
            </select>
          </label>
          <label>Sales model
            <select value={input.salesModel} onChange={(event) => patch("salesModel", event.target.value as ProjectCreateInput["salesModel"])}>
              <option value="ONLINE_CHECKOUT">Online checkout</option>
              <option value="LANDING_PAGE_OFFLINE_CLOSE">Landing page → sales close</option>
              <option value="MESSAGING_OFFLINE_CLOSE">Messenger/Zalo/phone</option>
              <option value="MARKETPLACE">Marketplace</option>
              <option value="MIXED">Mixed channels</option>
              <option value="AWARENESS_ONLY">Awareness only</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>Conversion tracking
            <select value={input.trackingConfidence} onChange={(event) => patch("trackingConfidence", event.target.value as ProjectCreateInput["trackingConfidence"])}>
              <option value="UNKNOWN">Chưa xác minh</option>
              <option value="HIGH">High confidence</option>
              <option value="MEDIUM">Medium confidence</option>
              <option value="LOW">Low confidence</option>
            </select>
          </label>
        </div>
        <div className="modalActions">
          <button className="secondaryAction" onClick={onClose}>Hủy</button>
          <button className="primaryAction" onClick={onCreate}><Plus size={16} /> Tạo project & rules</button>
        </div>
      </section>
    </div>
  );
}

function TeamAccessDialog({
  team,
  projects,
  onClose,
  notify
}: {
  team: TeamIdentity;
  projects: LocalProject[];
  onClose: () => void;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [members, setMembers] = useState<TeamMemberView[]>([]);
  const [email, setEmail] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const result = await team.api<{ members: TeamMemberView[] }>("/api/team/members");
      setMembers(result.members);
    } catch (error) { notify(error instanceof Error ? error.message : "TEAM_LOAD_FAILED", "error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  function toggleProject(projectId: string) {
    setProjectIds((current) => current.includes(projectId) ? current.filter((item) => item !== projectId) : [...current, projectId]);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || projectIds.length === 0) {
      notify("Nhập email và chọn ít nhất một project.", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await team.api<{ invited: boolean }>("/api/team/members", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, projectIds })
      });
      notify(result.invited ? "Đã gửi email mời và cấp project." : "Đã cập nhật project cho user.");
      setEmail(""); setProjectIds([]); await refresh();
    } catch (error) { notify(error instanceof Error ? error.message : "TEAM_SAVE_FAILED", "error"); }
    finally { setSaving(false); }
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="productModal wideModal" role="dialog" aria-modal="true" aria-labelledby="team-access-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalTitle">
          <div><span className="sectionKicker">ADMIN ONLY</span><h2 id="team-access-title">Team & project access</h2><p>Thêm email và chọn brand được thao tác. User có toàn quyền vận hành trên project được giao, nhưng không xóa project của người khác.</p></div>
          <button className="iconAction" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </div>
        <form className="teamAccessForm" onSubmit={save}>
          <label>Email user<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="media-buyer@agency.com" required /></label>
          <fieldset><legend>Project được giao</legend>
            {projects.length ? projects.map((project) => <label className="checkboxLine" key={project.config.projectId}>
              <input type="checkbox" checked={projectIds.includes(project.config.projectId)} onChange={() => toggleProject(project.config.projectId)} />
              <span>{project.config.projectName}</span>
            </label>) : <p className="helperText">Tạo project trước rồi cấp quyền cho user.</p>}
          </fieldset>
          <div className="modalActions"><button className="secondaryAction" type="button" onClick={onClose}>Đóng</button><button className="primaryAction" disabled={saving} type="submit"><UsersRound size={16} /> {saving ? "Đang lưu…" : "Mời / cập nhật user"}</button></div>
        </form>
        <div className="teamMemberList" aria-live="polite">
          <strong>Thành viên hiện tại</strong>
          {loading ? <p className="helperText">Đang tải team…</p> : members.map((member) => <button className="teamMemberRow" type="button" key={member.userId} onClick={() => { if (member.role === "user") { setEmail(member.email); setProjectIds(member.projectIds); } }} disabled={member.role === "admin"}>
            <span><strong>{member.email}</strong><small>{member.role === "admin" ? "Admin · tất cả project" : `${member.projectIds.length} project được giao`}</small></span>
            {member.role === "user" && <span className="statusBadge neutral">Sửa quyền</span>}
          </button>)}
        </div>
      </section>
    </div>
  );
}

function ProjectSetupView({
  project,
  onUpdate,
  onDelete,
  canDelete,
  notify
}: {
  project: LocalProject;
  onUpdate: (project: LocalProject, options?: { syncConfig?: boolean }) => void;
  onDelete: () => void;
  canDelete: boolean;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [metricDraft, setMetricDraft] = useState<MetricDefinition>({
    key: "CUSTOM_KPI",
    label: "Custom KPI",
    kind: "RATIO",
    numerator: "spend",
    denominator: "result",
    multiplier: 1,
    direction: "LOWER_IS_BETTER",
    nullWhenDenominatorZero: true
  });
  const operandOptions = [
    "spend", "result", "qualifiedResult", "revenue", "impressions", "clicks",
    ...project.metricMappings.map((item) => `metrics.${item.metricKey}`)
  ].filter((value, index, values) => values.indexOf(value) === index);

  function patchConfig(patch: Partial<ProjectConfig>) {
    const metricChanged = patch.primaryMetricKey && patch.primaryMetricKey !== project.config.primaryMetricKey;
    onUpdate({
      ...project,
      config: { ...project.config, ...patch },
      rules: metricChanged
        ? project.rules.map((rule) => ({ ...rule, metricKey: patch.primaryMetricKey as string }))
        : project.rules,
      updatedAt: new Date().toISOString()
    });
  }

  function updateWindow(index: number, patch: Partial<ProjectConfig["windows"][number]>) {
    patchConfig({ windows: project.config.windows.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  }

  function normalizeWindowWeights() {
    const sum = project.config.windows.reduce((total, item) => total + item.weight, 0);
    if (sum <= 0) return notify("Tổng weight phải lớn hơn 0.", "error");
    patchConfig({
      windows: project.config.windows.map((item) => ({ ...item, weight: Number((item.weight / sum).toFixed(4)) }))
    });
    notify("Đã normalize window weights về 100%.");
  }

  function addMetricDefinition() {
    const parsed = metricDefinitionSchema.safeParse({
      ...metricDraft,
      key: metricDraft.key.trim().toUpperCase().replace(/\s+/g, "_"),
      denominator: metricDraft.kind === "SUM" ? null : metricDraft.denominator
    });
    if (!parsed.success) {
      return notify(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · "), "error");
    }
    if (project.metricDefinitions.some((item) => item.key === parsed.data.key)) {
      return notify(`Metric key ${parsed.data.key} đã tồn tại.`, "error");
    }
    onUpdate({
      ...project,
      metricDefinitions: [...project.metricDefinitions, parsed.data],
      updatedAt: new Date().toISOString()
    });
    setMetricDraft((current) => ({ ...current, key: "CUSTOM_KPI", label: "Custom KPI" }));
    notify(`Đã thêm metric ${parsed.data.key}.`);
  }

  function removeMetricDefinition(metric: MetricDefinition) {
    if (standardMetricLibrary.some((item) => item.key === metric.key)) return;
    if (project.config.primaryMetricKey === metric.key) {
      return notify("Hãy đổi Primary KPI trước khi xóa metric này.", "error");
    }
    onUpdate({
      ...project,
      metricDefinitions: project.metricDefinitions.filter((item) => item.key !== metric.key),
      updatedAt: new Date().toISOString()
    });
    notify(`Đã xóa metric ${metric.key}.`);
  }

  const weightSum = project.config.windows.reduce((sum, item) => sum + item.weight, 0);
  return (
    <div className="viewStack">
      <section className="sectionCard">
        <div className="sectionHeader">
          <div><span className="sectionKicker">00_PROJECT_CONFIG</span><h2>Thông tin project</h2><p>Mỗi brand có một config riêng; engine và code dùng chung.</p></div>
          <span className="statusBadge neutral mono">{project.config.projectId}</span>
        </div>
        <div className="formGrid">
          <label>Project name<input value={project.config.projectName} onChange={(event) => patchConfig({ projectName: event.target.value })} /></label>
          <label>Platform<input value={project.config.platform} onChange={(event) => patchConfig({ platform: event.target.value })} /></label>
          <label>Account ID<input value={project.config.accountId} onChange={(event) => patchConfig({ accountId: event.target.value })} /></label>
          <label>Timezone<input value={project.config.timezone} onChange={(event) => patchConfig({ timezone: event.target.value })} /></label>
          <label>Currency<input maxLength={3} value={project.config.currency} onChange={(event) => patchConfig({ currency: event.target.value.toUpperCase() })} /></label>
          <label>Start date<input type="date" value={project.config.startDate} onChange={(event) => patchConfig({ startDate: event.target.value })} /></label>
        </div>
      </section>

      <ScopeManager project={project} onUpdate={onUpdate} notify={notify} />

      <section className="sectionCard">
        <div className="sectionHeader">
          <div><span className="sectionKicker">METRIC MODEL</span><h2>KPI và data confidence</h2><p>Project khác KPI chỉ đổi config/mapping; không sửa công thức.</p></div>
        </div>
        <div className="formGrid">
          <label hidden={project.config.optimizationScopes.length > 0}>Primary KPI
            <select value={project.config.primaryMetricKey} onChange={(event) => patchConfig({ primaryMetricKey: event.target.value })}>
              {project.metricDefinitions.map((metric) => <option key={metric.key} value={metric.key}>{metric.key} · {metric.label}</option>)}
            </select>
          </label>
          <label hidden={project.config.optimizationScopes.length > 0}>Target
            <input type="number" min="0" value={project.config.target} onChange={(event) => patchConfig({ target: Number(event.target.value) })} />
          </label>
          <label hidden={project.config.optimizationScopes.length > 0}>Result nghĩa là<input value={project.config.optimizationEventLabel} onChange={(event) => patchConfig({ optimizationEventLabel: event.target.value })} /></label>
          <label>Sales model
            <select value={project.config.salesModel} onChange={(event) => patchConfig({ salesModel: event.target.value as ProjectConfig["salesModel"] })}>
              <option value="ONLINE_CHECKOUT">Online checkout</option>
              <option value="LANDING_PAGE_OFFLINE_CLOSE">Landing page → sales close</option>
              <option value="MESSAGING_OFFLINE_CLOSE">Messenger/Zalo/phone</option>
              <option value="MARKETPLACE">Marketplace</option>
              <option value="MIXED">Mixed channels</option>
              <option value="AWARENESS_ONLY">Awareness only</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>Tracking confidence
            <select value={project.config.trackingConfidence} onChange={(event) => patchConfig({ trackingConfidence: event.target.value as ProjectConfig["trackingConfidence"] })}>
              <option value="UNKNOWN">Unknown</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
            </select>
          </label>
          <label>CAPI status
            <select value={project.config.capiStatus} onChange={(event) => patchConfig({ capiStatus: event.target.value as ProjectConfig["capiStatus"] })}>
              <option value="UNKNOWN">Unknown</option><option value="VERIFIED">Verified</option><option value="PARTIAL">Partial</option><option value="NOT_CONFIGURED">Not configured</option><option value="NOT_APPLICABLE">N/A</option>
            </select>
          </label>
        </div>
        <div className="subsectionDivider">
          <div className="subsectionTitle">
            <div><strong>Metric dictionary</strong><span>Thêm KPI riêng từ field chuẩn hoặc supporting metric đã map ở Data import.</span></div>
          </div>
          <div className="metricDefinitionRows">
            {project.metricDefinitions.map((metric) => {
              const isStandard = standardMetricLibrary.some((item) => item.key === metric.key);
              return (
                <div key={metric.key}>
                  <code>{metric.key}</code>
                  <span><strong>{metric.label}</strong><small>{metric.numerator}{metric.denominator ? ` / ${metric.denominator}` : ""} × {metric.multiplier}</small></span>
                  <em>{metric.direction === "LOWER_IS_BETTER" ? "Lower is better" : "Higher is better"}</em>
                  {isStandard
                    ? <span className="statusBadge neutral">Core</span>
                    : <button className="iconAction dangerIcon" aria-label={`Xóa metric ${metric.key}`} onClick={() => removeMetricDefinition(metric)}><Trash2 size={14} /></button>}
                </div>
              );
            })}
          </div>
          <div className="customMetricBuilder">
            <label>Metric key<input value={metricDraft.key} onChange={(event) => setMetricDraft((current) => ({ ...current, key: event.target.value }))} /></label>
            <label>Tên hiển thị<input value={metricDraft.label} onChange={(event) => setMetricDraft((current) => ({ ...current, label: event.target.value }))} /></label>
            <label>Loại
              <select value={metricDraft.kind} onChange={(event) => setMetricDraft((current) => ({
                ...current,
                kind: event.target.value as MetricDefinition["kind"],
                denominator: event.target.value === "SUM" ? null : current.denominator ?? "result"
              }))}>
                <option value="RATIO">Ratio</option><option value="RATE">Rate</option><option value="SUM">Sum</option>
              </select>
            </label>
            <label>Numerator
              <select value={metricDraft.numerator} onChange={(event) => setMetricDraft((current) => ({ ...current, numerator: event.target.value }))}>
                {operandOptions.map((operand) => <option key={operand} value={operand}>{operand}</option>)}
              </select>
            </label>
            <label>Denominator
              <select disabled={metricDraft.kind === "SUM"} value={metricDraft.denominator ?? ""} onChange={(event) => setMetricDraft((current) => ({ ...current, denominator: event.target.value }))}>
                {operandOptions.map((operand) => <option key={operand} value={operand}>{operand}</option>)}
              </select>
            </label>
            <label>Multiplier<input type="number" min="0.0001" step="0.01" value={metricDraft.multiplier} onChange={(event) => setMetricDraft((current) => ({ ...current, multiplier: Number(event.target.value) }))} /></label>
            <label>Direction
              <select value={metricDraft.direction} onChange={(event) => setMetricDraft((current) => ({ ...current, direction: event.target.value as MetricDefinition["direction"] }))}>
                <option value="LOWER_IS_BETTER">Lower is better</option><option value="HIGHER_IS_BETTER">Higher is better</option>
              </select>
            </label>
            <button className="secondaryAction" onClick={addMetricDefinition}><Plus size={15} /> Thêm metric</button>
          </div>
        </div>
      </section>

      <section className="sectionCard" hidden={project.config.optimizationScopes.length > 0}>
        <div className="sectionHeader">
          <div><span className="sectionKicker">LOOKBACK & WEIGHTS</span><h2>Cửa sổ dữ liệu</h2><p>Today không nằm trong Short/Long. Missing optional window được renormalize.</p></div>
          <span className={`statusBadge ${Math.abs(weightSum - 1) < 0.0001 ? "success" : "danger"}`}>{Math.round(weightSum * 100)}%</span>
        </div>
        <div className="windowGrid">
          {project.config.windows.map((window, index) => (
            <article key={window.id}>
              <strong>{window.id}</strong>
              <label>Days<input type="number" min="1" disabled={window.id === "TODAY" || window.id === "LIFETIME"} value={window.days ?? ""} onChange={(event) => updateWindow(index, { days: event.target.value ? Number(event.target.value) : null })} /></label>
              <label>Weight %<input type="number" min="0" max="100" value={Math.round(window.weight * 100)} onChange={(event) => updateWindow(index, { weight: Number(event.target.value) / 100 })} /></label>
              <label className="checkboxLine"><input type="checkbox" checked={window.required} onChange={(event) => updateWindow(index, { required: event.target.checked })} /> Required</label>
            </article>
          ))}
        </div>
        <div className="cardActions">
          <span className="helperText">Bắt buộc tổng weight = 100% trước khi run.</span>
          <button className="secondaryAction" onClick={normalizeWindowWeights}><RefreshCw size={15} /> Normalize weights</button>
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader">
          <div><span className="sectionKicker">GUARDRAILS</span><h2>Context và scale limits</h2><p>Context được kiểm tra riêng, không nhân vào Entity Score. Campaign CBO và Ad set ABO mới được tăng/giảm budget.</p></div>
        </div>
        <div className="formGrid">
          {(["CAMPAIGN", "ADSET", "AD"] as const).map((level) => (
            <div className="weightPair" key={level} hidden={project.config.optimizationScopes.length > 0}>
              <strong>{level}</strong>
              <label>Entity %<input type="number" min="0" max="100" value={project.config.contextWeights[level].entity * 100} onChange={(event) => {
                const entity = Number(event.target.value) / 100;
                patchConfig({ contextWeights: { ...project.config.contextWeights, [level]: { entity, context: 1 - entity } } });
              }} /></label>
              <label>Context %<input readOnly value={Math.round(project.config.contextWeights[level].context * 100)} /></label>
            </div>
          ))}
          <label>Max scale mỗi action %
            <input type="number" min="0" max="100" value={project.config.maxDailyScalePct * 100} onChange={(event) => patchConfig({ maxDailyScalePct: Number(event.target.value) / 100 })} />
          </label>
          <label>Max scale actions / ngày
            <input type="number" min="0" value={project.config.maxDailyScaleActions} onChange={(event) => patchConfig({ maxDailyScaleActions: Number(event.target.value) })} />
          </label>
          <label>Freshness tối đa (giờ)
            <input type="number" min="1" value={project.config.dataFreshnessHours} onChange={(event) => patchConfig({ dataFreshnessHours: Number(event.target.value) })} />
          </label>
          <label className="checkboxLine fullWidth">
            <input type="checkbox" checked={project.config.deferParentScaleWhenChildAction} onChange={(event) => patchConfig({ deferParentScaleWhenChildAction: event.target.checked })} />
            Không scale parent khi còn child cần tắt.
          </label>
        </div>
        <div className="cardActions">
          {canDelete && <button className="dangerAction" onClick={() => void onDelete()}><Trash2 size={15} /> Xóa project</button>}
          <span className="helperText"><Save size={14} /> Mọi thay đổi được auto-save vào IndexedDB.</span>
        </div>
      </section>
    </div>
  );
}

function DecisionBoard({
  project,
  onUpdate,
  notify,
  teamApi,
  onSync
}: {
  project: LocalProject;
  onUpdate: (project: LocalProject, options?: { syncConfig?: boolean }) => void;
  notify: (message: string, tone?: "success" | "error") => void;
  teamApi?: TeamApi;
  onSync?: () => Promise<SourceSyncResponse | null>;
}) {
  const latestFactDate = project.facts.reduce<string | null>(
    (latest, fact) => !latest || fact.date > latest ? fact.date : latest,
    null
  );
  const [asOfDate, setAsOfDate] = useState(latestFactDate ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [level, setLevel] = useState<"ALL" | "CAMPAIGN" | "ADSET" | "AD">("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const run = latestRun(project);
  const recommendations = (run?.recommendations ?? []) as RecommendationView[];
  const filtered = recommendations.filter((item) =>
    (level === "ALL" || item.entityLevel === level)
    && (actionFilter === "ALL" || item.recommendedAction === actionFilter)
    && (!search || `${item.entityName} ${item.entityId}`.toLowerCase().includes(search.toLowerCase()))
  );
  const source = project.config.dataSource;
  const canSync = source.kind === "GOOGLE_SHEETS" && Boolean(onSync);

  async function refreshSource() {
    if (!onSync) return;
    setSyncing(true);
    try {
      const response = await onSync();
      if (response?.sync.latestDataDate) setAsOfDate(response.sync.latestDataDate);
    } finally {
      setSyncing(false);
    }
  }

  async function executeRun() {
    if (!project.facts.length) return notify("Chưa có fact rows. Hãy import data trước.", "error");
    if (!project.rules.some((rule) => rule.enabled)) return notify("Không có rule enabled.", "error");
    setBusy(true);
    try {
      const runAt = new Date().toISOString();
      const output = teamApi ? await teamApi<OptimizationRun>(`/api/projects/${encodeURIComponent(project.config.projectId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asOfDate, runAt })
      }) : await apiJson<OptimizationRun>("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asOfDate,
          runAt,
          config: project.config,
          metricDefinitions: project.metricDefinitions,
          rules: project.rules,
          facts: project.facts,
          priorActions: project.actions.map((action) => ({
              actionKey: action.actionKey,
              approvalStatus: action.approvalStatus,
              recommendedAction: action.recommendedAction
            }))
        })
      });
      const actionIds = new Set(project.actions.map((item) => item.id));
      const newActions = output.actions.filter((item) => !actionIds.has(item.id));
      onUpdate({
        ...project,
        runs: [output, ...project.runs].slice(0, 60),
        actions: [...newActions, ...project.actions],
        updatedAt: runAt
      }, { syncConfig: false });
      if (output.status === "BLOCKED") notify(`Run bị chặn: ${output.qc.issues.map((item) => item.code).join(", ")}`, "error");
      else notify(`Engine hoàn tất: ${output.recommendations.length} decision · ${newActions.length} action mới.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Engine run thất bại.", "error");
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    TURN_OFF: recommendations.filter((item) => item.recommendedAction === "TURN_OFF").length,
    INCREASE_BUDGET: recommendations.filter((item) => item.recommendedAction === "INCREASE_BUDGET").length,
    KEEP: recommendations.filter((item) => item.recommendedAction === "KEEP").length,
    REVIEW: recommendations.filter((item) => item.recommendedAction === "REVIEW_MANUALLY" || item.recommendedAction === "PENDING_DATA").length
  };

  return (
    <div className="viewStack">
      <section className="runBar">
        <div>
          <span className="sectionKicker">DETERMINISTIC ENGINE</span>
          <strong>Chạy bottom-up: Ad → Ad set → Campaign</strong>
          <small>{project.facts.length.toLocaleString("vi-VN")} fact rows · {project.rules.filter((rule) => rule.enabled).length} rules enabled</small>
          {source.kind === "GOOGLE_SHEETS" && (
            <small>
              Google Sheets · {source.autoSyncEnabled ? `tự refresh mỗi ${source.syncIntervalMinutes} phút khi tool đang mở` : "auto refresh đang tắt"}
              {source.lastSyncedAt ? ` · lần cuối ${new Date(source.lastSyncedAt).toLocaleString("vi-VN")}` : " · chưa refresh"}
            </small>
          )}
        </div>
        <label>As-of date<input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /></label>
        {canSync && (
          <button className="secondaryAction large" onClick={() => void refreshSource()} disabled={syncing || busy}>
            <RefreshCw className={syncing ? "spin" : ""} size={17} />
            {syncing ? "Đang refresh…" : source.autoRunAfterSync ? "Refresh & auto-run" : "Refresh data"}
          </button>
        )}
        <button className="primaryAction large" onClick={executeRun} disabled={busy || syncing}>
          {busy ? <RefreshCw className="spin" size={17} /> : <Play size={17} />}
          {busy ? "Đang chạy…" : "Run optimization"}
        </button>
      </section>

      <section className="metricStrip">
        <article><span className="metricIcon red"><XCircle size={18} /></span><div><small>Cần tắt</small><strong>{counts.TURN_OFF}</strong><em>ads / ad sets / camps</em></div></article>
        <article><span className="metricIcon green"><CircleDollarSign size={18} /></span><div><small>Invest thêm</small><strong>{counts.INCREASE_BUDGET}</strong><em>budget owners</em></div></article>
        <article><span className="metricIcon blue"><CheckCircle2 size={18} /></span><div><small>Giữ</small><strong>{counts.KEEP}</strong><em>đang đạt rule</em></div></article>
        <article><span className="metricIcon amber"><AlertTriangle size={18} /></span><div><small>Cần review/data</small><strong>{counts.REVIEW}</strong><em>không auto-decide</em></div></article>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader filtersHeader">
          <div>
            <span className="sectionKicker">LATEST RUN</span>
            <h2>Optimization decisions</h2>
            <p>{run ? `${new Date(run.runAt).toLocaleString("vi-VN")} · dữ liệu đến ${run.asOfDate ?? "N/A"} · ${run.status} · QC ${run.qc.status}` : "Chưa có run."}</p>
          </div>
          <div className="filterBar">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm entity…" />
            <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
              <option value="ALL">Tất cả cấp</option><option value="CAMPAIGN">Campaign</option><option value="ADSET">Ad set</option><option value="AD">Ad</option>
            </select>
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              <option value="ALL">Tất cả action</option><option value="TURN_OFF">Turn off</option><option value="INCREASE_BUDGET">Increase</option><option value="DECREASE_BUDGET">Decrease</option><option value="KEEP">Keep</option><option value="PENDING_DATA">Pending data</option><option value="REVIEW_MANUALLY">Manual review</option>
            </select>
          </div>
        </div>
        {run?.classificationSummary && (
          <div className="classificationSummary">
            <span className="included">PFM được tối ưu: {run.classificationSummary.pfmIncluded.toLocaleString("vi-VN")} dòng</span>
            <span className="excluded">Non-PFM đã loại: {run.classificationSummary.nonPfmExcluded.toLocaleString("vi-VN")} dòng</span>
            <span className="review">Chưa phân loại: {run.classificationSummary.reviewUnclassified.toLocaleString("vi-VN")} dòng</span>
          </div>
        )}
        {!run ? (
          <div className="emptyState"><Activity size={28} /><strong>Chưa có decision</strong><span>Import data, kiểm tra rules, rồi chạy engine.</span></div>
        ) : run.status === "BLOCKED" ? (
          <div className="blockedState">
            <ShieldAlert size={30} />
            <div><strong>Engine đã chặn destructive recommendation</strong>{run.qc.issues.map((issue) => <p key={issue.code}><b>{issue.code}</b> · {issue.message}</p>)}</div>
          </div>
        ) : (
          <div className="tableScroller">
            <table className="dataTable decisionTable">
              <thead><tr><th>Entity / scope</th><th>KPI signal</th><th>Plan / Cohort / Context</th><th>Action</th><th>Adjust</th><th>Confidence</th><th>Rule / reason</th><th /></tr></thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={`${item.scopeId}-${item.entityLevel}-${item.entityId}`}>
                    <td><span className={`levelPill ${item.entityLevel.toLowerCase()}`}>{item.entityLevel}</span><strong>{item.entityName}</strong><small>{item.scopeName}</small><small className="mono">{item.entityId}</small></td>
                    <td className="mono">{formatNumber(item.currentMetric, project.config.primaryMetricKey === "ROAS" || ["CTR", "CVR"].includes(project.config.primaryMetricKey) ? undefined : project.config.currency)}<small>Target {formatNumber(item.targetMetric, ["ROAS", "CTR", "CVR"].includes(project.config.primaryMetricKey) ? undefined : project.config.currency)}</small></td>
                    <td className="mono">
                      {item.weightedAchievement === null ? "N/A" : `${Math.round(item.weightedAchievement * 100)}%`}
                      <small>Cohort {item.cohortWeightedAchievement === null ? "N/A" : `${Math.round(item.cohortWeightedAchievement * 100)}%`} · Context {item.contextWeightedAchievement === null ? "N/A" : `${Math.round(item.contextWeightedAchievement * 100)}%`}</small>
                    </td>
                    <td><span className={`actionPill action-${item.recommendedAction.toLowerCase()}`}>{actionLabel(item.recommendedAction)}</span></td>
                    <td className="mono">{item.adjustmentPct === null ? "—" : `${item.adjustmentPct > 0 ? "+" : ""}${Math.round(item.adjustmentPct * 100)}%`}</td>
                    <td><span className="confidenceBar"><i style={{ width: `${item.confidence * 100}%` }} /></span><small>{Math.round(item.confidence * 100)}%</small></td>
                    <td><strong className="mono smallText">{item.matchedRuleIds.join(", ") || "—"}</strong><small>{item.reasonCodes.join(" · ")}</small></td>
                    <td><button className="iconAction" onClick={() => setSelected(item)} aria-label={`Xem evidence ${item.entityName}`}><ChevronRight size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="modalBackdrop drawerBackdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside className="evidenceDrawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalTitle"><div><span className="sectionKicker">{selected.entityLevel} · {selected.scopeName}</span><h2 id="evidence-title">{selected.entityName}</h2><p className="mono">{selected.entityId}</p></div><button className="iconAction" onClick={() => setSelected(null)} aria-label="Đóng"><X size={18} /></button></div>
            <div className="evidenceSummary">
              <span className={`actionPill action-${selected.recommendedAction.toLowerCase()}`}>{actionLabel(selected.recommendedAction)}</span>
              <strong>{selected.adjustmentPct === null ? "" : `${selected.adjustmentPct > 0 ? "+" : ""}${Math.round(selected.adjustmentPct * 100)}%`}</strong>
              <p>{selected.reasonCodes.join(" · ")}</p>
            </div>
            <dl className="evidenceList">
              <div><dt>KPI today</dt><dd>{formatNumber(selected.currentMetric)}</dd></div>
              <div><dt>Target</dt><dd>{formatNumber(selected.targetMetric)}</dd></div>
              <div><dt>Plan geometric</dt><dd>{selected.weightedAchievement === null ? "N/A" : `${Math.round(selected.weightedAchievement * 100)}%`}</dd></div>
              <div><dt>Cohort geometric</dt><dd>{selected.cohortWeightedAchievement === null ? "N/A" : `${Math.round(selected.cohortWeightedAchievement * 100)}%`}</dd></div>
              <div><dt>Cohort benchmark</dt><dd>{formatNumber(selected.cohortBenchmark)}</dd></div>
              <div><dt>Project / parent context</dt><dd>{selected.contextWeightedAchievement === null ? "N/A" : `${Math.round(selected.contextWeightedAchievement * 100)}%`}</dd></div>
              <div><dt>Window thấp nhất</dt><dd>{selected.minimumWindowAchievement === null ? "N/A" : `${Math.round(selected.minimumWindowAchievement * 100)}%`}</dd></div>
              <div><dt>Trend signal / baseline</dt><dd>{selected.trendRatio === null ? "N/A" : `${Math.round(selected.trendRatio * 100)}%`}</dd></div>
              <div><dt>Red flag windows</dt><dd>{selected.redFlagWindowIds.length ? selected.redFlagWindowIds.join(", ") : "Không"}</dd></div>
              <div><dt>Evaluated value</dt><dd>{formatNumber(selected.evaluatedValue)}</dd></div>
              <div><dt>Evidence window</dt><dd>{selected.evidenceWindow}</dd></div>
              <div><dt>Budget type</dt><dd>{selected.budgetType}</dd></div>
              <div><dt>Status</dt><dd>{selected.currentStatus}</dd></div>
              <div><dt>Execution phase</dt><dd>{selected.executionPhase}</dd></div>
              <div><dt>Confidence</dt><dd>{Math.round(selected.confidence * 100)}%</dd></div>
            </dl>
            {selected.windowMetrics && selected.windowMetrics.length > 0 && (
              <div className="windowEvidence">
                <strong>Performance theo time window</strong>
                <div className="tableScroller">
                  <table className="dataTable compactTable">
                    <thead><tr><th>Window</th><th>Khoảng ngày</th><th>KPI</th><th>Achievement</th><th>Spend</th><th>Result</th></tr></thead>
                    <tbody>
                      {selected.windowMetrics.map((window) => (
                        <tr key={window.id}>
                          <td><strong>{window.label || window.id}</strong><small>{window.includeInScore ? `Tính điểm · ${window.role}` : `Bổ trợ · ${window.role}`}</small></td>
                          <td className="mono smallText">{window.start} → {window.endExclusive}</td>
                          <td className="mono">{formatNumber(window.value, ["ROAS", "CTR", "CVR"].includes(project.config.primaryMetricKey) ? undefined : project.config.currency)}</td>
                          <td className="mono">{window.achievement === null ? "N/A" : `${Math.round(window.achievement * 100)}%`}</td>
                          <td className="mono">{formatNumber(window.spend, project.config.currency)}</td>
                          <td className="mono">{formatNumber(window.result)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="ruleTrace"><strong>Matched rules</strong>{selected.matchedRuleIds.length ? selected.matchedRuleIds.map((id) => <code key={id}>{id}</code>) : <span>Không có rule match</span>}</div>
          </aside>
        </div>
      )}
    </div>
  );
}

function ActionQueue({
  project,
  operatorName,
  onUpdate,
  notify,
  teamApi
}: {
  project: LocalProject;
  operatorName: string;
  onUpdate: (project: LocalProject, options?: { syncConfig?: boolean }) => void;
  notify: (message: string, tone?: "success" | "error") => void;
  teamApi?: TeamApi;
}) {
  const [status, setStatus] = useState<"ALL" | ApprovalStatus>("PENDING");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const selected = project.actions.find((item) => item.id === selectedId) ?? null;
  const actions = project.actions.filter((action) => status === "ALL" || action.approvalStatus === status);

  function open(action: ActionRecord) {
    setSelectedId(action.id);
    setNote(action.note ?? "");
  }

  async function transition(to: ApprovalStatus) {
    if (!selected) return;
    const valid: Record<ApprovalStatus, ApprovalStatus[]> = {
      PENDING: ["DONE", "REJECTED", "DEFERRED"],
      DEFERRED: ["PENDING", "DONE", "REJECTED"],
      DONE: [],
      REJECTED: []
    };
    if (!valid[selected.approvalStatus].includes(to)) return notify(`Transition ${selected.approvalStatus} → ${to} không hợp lệ.`, "error");
    const at = new Date().toISOString();
    const actor = operatorName.trim() || "Media Buyer";
    const event: ActionEvent = {
      id: crypto.randomUUID(),
      actionId: selected.id,
      at,
      actor,
      from: selected.approvalStatus,
      to,
      note: note || null
    };
    if (teamApi) {
      try {
        await teamApi(`/api/projects/${encodeURIComponent(project.config.projectId)}/actions/${encodeURIComponent(selected.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, at, note: note || null })
        });
      } catch (error) {
        return notify(error instanceof Error ? error.message : "ACTION_UPDATE_FAILED", "error");
      }
    }
    onUpdate({
      ...project,
      actions: project.actions.map((item) => item.id === selected.id ? {
        ...item,
        approvalStatus: to,
        reviewer: actor,
        executedAt: to === "DONE" ? at : item.executedAt,
        note: note || null
      } : item),
      actionLog: [event, ...project.actionLog],
      updatedAt: at
    }, { syncConfig: false });
    setSelectedId(null);
    notify(`Action đã chuyển sang ${to}.`);
  }

  return (
    <div className="viewStack">
      <section className="metricStrip">
        {(["PENDING", "DONE", "DEFERRED", "REJECTED"] as const).map((item, index) => (
          <article key={item}><span className={`metricIcon ${["amber", "green", "blue", "red"][index]}`}><ClipboardCheck size={18} /></span><div><small>{item}</small><strong>{project.actions.filter((action) => action.approvalStatus === item).length}</strong><em>actions</em></div></article>
        ))}
      </section>
      <section className="sectionCard">
        <div className="sectionHeader filtersHeader">
          <div><span className="sectionKicker">MANUAL EXECUTION WORKFLOW</span><h2>Action queue</h2><p>V1 không gọi Meta API; media buyer xác nhận sau khi thao tác trong Ads Manager.</p></div>
          <div className="segmented">
            {(["PENDING", "DEFERRED", "DONE", "REJECTED", "ALL"] as const).map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>)}
          </div>
        </div>
        {!actions.length ? (
          <div className="emptyState"><ClipboardCheck size={28} /><strong>Không có action ở trạng thái này</strong><span>Chạy engine hoặc đổi bộ lọc.</span></div>
        ) : (
          <div className="tableScroller">
            <table className="dataTable">
              <thead><tr><th>Entity</th><th>Action</th><th>Evidence</th><th>Confidence</th><th>Run time</th><th>Status</th><th /></tr></thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.id}>
                    <td><span className={`levelPill ${action.entityLevel.toLowerCase()}`}>{action.entityLevel}</span><strong>{action.entityName}</strong><small className="mono">{action.entityId}</small></td>
                    <td><span className={`actionPill action-${action.recommendedAction.toLowerCase()}`}>{actionLabel(action.recommendedAction)}</span><small>{action.adjustmentPct === null ? "" : `${Math.round(action.adjustmentPct * 100)}%`}</small></td>
                    <td><strong>{formatNumber(action.currentMetric)} / {formatNumber(action.targetMetric)}</strong><small>{action.reasonCodes.join(" · ")}</small></td>
                    <td className="mono">{Math.round(action.confidence * 100)}%</td>
                    <td>{new Date(action.runAt).toLocaleString("vi-VN")}</td>
                    <td><span className={`statusBadge status-${action.approvalStatus.toLowerCase()}`}>{action.approvalStatus}</span></td>
                    <td><button className="secondaryAction small" onClick={() => open(action)} disabled={action.approvalStatus === "DONE" || action.approvalStatus === "REJECTED"}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedId(null)}>
          <section className="productModal" role="dialog" aria-modal="true" aria-labelledby="action-review-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalTitle"><div><span className="sectionKicker">{selected.entityLevel}</span><h2 id="action-review-title">{selected.entityName}</h2><p>{actionLabel(selected.recommendedAction)} {selected.adjustmentPct === null ? "" : `${Math.round(selected.adjustmentPct * 100)}%`}</p></div><button className="iconAction" onClick={() => setSelectedId(null)} aria-label="Đóng"><X size={18} /></button></div>
            <div className="actionEvidence">
              <div><small>KPI / target</small><strong>{formatNumber(selected.currentMetric)} / {formatNumber(selected.targetMetric)}</strong></div>
              <div><small>Confidence</small><strong>{Math.round(selected.confidence * 100)}%</strong></div>
              <div><small>Rule</small><strong>{selected.matchedRuleIds.join(", ")}</strong></div>
            </div>
            <label className="modalTextarea">Note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Đã kiểm tra Ads Manager / lý do reject / thời điểm defer…" /></label>
            <div className="modalActions spread">
              <button className="dangerAction" onClick={() => transition("REJECTED")}>Reject</button>
              <button className="secondaryAction" onClick={() => transition(selected.approvalStatus === "DEFERRED" ? "PENDING" : "DEFERRED")}>{selected.approvalStatus === "DEFERRED" ? "Đưa lại Pending" : "Defer"}</button>
              <button className="primaryAction" onClick={() => transition("DONE")}><CheckCircle2 size={16} /> Mark done</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function RunsAudit({ project }: { project: LocalProject }) {
  return (
    <div className="auditGrid">
      <section className="sectionCard">
        <div className="sectionHeader"><div><span className="sectionKicker">ENGINE RUNS</span><h2>{project.runs.length} runs</h2><p>Snapshot rule version và QC của từng lần chạy.</p></div></div>
        <div className="timelineList">
          {project.runs.length ? project.runs.map((run) => (
            <article key={run.runId}>
              <span className={`timelineIcon ${run.status === "BLOCKED" ? "danger" : "success"}`}>{run.status === "BLOCKED" ? <ShieldAlert size={16} /> : <Play size={16} />}</span>
              <div><strong>{run.status} · QC {run.qc.status}</strong><small>{new Date(run.runAt).toLocaleString("vi-VN")} · {run.recommendations.length} decisions · {run.actions.length} actions</small><code>{run.runId}</code></div>
            </article>
          )) : <div className="emptyState compact"><History size={24} /><span>Chưa có run.</span></div>}
        </div>
      </section>
      <section className="sectionCard">
        <div className="sectionHeader"><div><span className="sectionKicker">IMPORT HISTORY</span><h2>{project.imports.length} imports</h2><p>Accepted/rejected được lưu theo batch.</p></div></div>
        <div className="timelineList">
          {project.imports.length ? project.imports.map((item) => (
            <article key={item.id}>
              <span className={`timelineIcon ${item.rejected ? "warning" : "success"}`}><FileSpreadsheet size={16} /></span>
              <div><strong>{item.fileName}</strong><small>{item.entityLevel} · {item.accepted} accepted · {item.rejected} rejected · {item.mode}</small><code>{new Date(item.importedAt).toLocaleString("vi-VN")}</code></div>
            </article>
          )) : <div className="emptyState compact"><Database size={24} /><span>Chưa import data.</span></div>}
        </div>
      </section>
      <section className="sectionCard fullSpan">
        <div className="sectionHeader"><div><span className="sectionKicker">APPEND-ONLY ACTION LOG</span><h2>{project.actionLog.length} events</h2><p>Action DONE/REJECTED không được sửa ngược.</p></div></div>
        <div className="tableScroller">
          <table className="dataTable">
            <thead><tr><th>Time</th><th>Action ID</th><th>Actor</th><th>Transition</th><th>Note</th></tr></thead>
            <tbody>
              {project.actionLog.map((event) => <tr key={event.id}><td>{new Date(event.at).toLocaleString("vi-VN")}</td><td className="mono">{event.actionId}</td><td>{event.actor}</td><td><strong>{event.from} → {event.to}</strong></td><td>{event.note || "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
