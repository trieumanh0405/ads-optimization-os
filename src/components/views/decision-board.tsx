"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Play,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle
} from "lucide-react";
import type { ActionRecord } from "@/core/actions";
import { apiJson } from "@/product/api";
import type { TeamApi } from "@/product/team-api";
import type { LocalProject, OptimizationRun } from "@/product/types";
import { actionLabel, formatNumber, latestRun } from "../helpers/format-utils";

export type RecommendationView = {
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

export type SourceSyncResponse = {
  sync: {
    syncedAt: string;
    status: "SUCCESS" | "PARTIAL";
    accepted: number;
    rejected: number;
    latestDataDate: string | null;
    run: OptimizationRun | null;
    skipped?: boolean;
  };
  project: LocalProject;
};

export type DecisionBoardProps = {
  project: LocalProject;
  onProjectChange: (project: LocalProject) => void;
  teamApi: TeamApi | null;
  toast: (message: string, tone?: "info" | "success" | "error") => void;
  onSync?: () => Promise<SourceSyncResponse | null>;
};

export function DecisionBoard({
  project,
  onProjectChange,
  toast,
  teamApi,
  onSync
}: DecisionBoardProps) {
  const latestFactDate = project.facts.reduce<string | null>(
    (latest, fact) => (!latest || fact.date > latest ? fact.date : latest),
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
  const filtered = recommendations.filter(
    (item) =>
      (level === "ALL" || item.entityLevel === level) &&
      (actionFilter === "ALL" || item.recommendedAction === actionFilter) &&
      (!search || `${item.entityName} ${item.entityId}`.toLowerCase().includes(search.toLowerCase()))
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
    if (!project.facts.length) return toast("Chưa có fact rows. Hãy import data trước.", "error");
    if (!project.rules.some((rule) => rule.enabled)) return toast("Không có rule enabled.", "error");
    setBusy(true);
    try {
      const runAt = new Date().toISOString();
      const output = teamApi
        ? await teamApi<OptimizationRun>(`/api/projects/${encodeURIComponent(project.config.projectId)}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asOfDate, runAt })
          })
        : await apiJson<OptimizationRun>("/api/optimize", {
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
      onProjectChange({
        ...project,
        runs: [output, ...project.runs].slice(0, 60),
        actions: [...newActions, ...project.actions],
        updatedAt: runAt
      });
      if (output.status === "BLOCKED")
        toast(`Run bị chặn: ${output.qc.issues.map((item) => item.code).join(", ")}`, "error");
      else toast(`Engine hoàn tất: ${output.recommendations.length} decision · ${newActions.length} action mới.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Engine run thất bại.", "error");
    } finally {
      setBusy(false);
    }
  }

  const counts = {
    TURN_OFF: recommendations.filter((item) => item.recommendedAction === "TURN_OFF").length,
    INCREASE_BUDGET: recommendations.filter((item) => item.recommendedAction === "INCREASE_BUDGET").length,
    KEEP: recommendations.filter((item) => item.recommendedAction === "KEEP").length,
    REVIEW: recommendations.filter(
      (item) => item.recommendedAction === "REVIEW_MANUALLY" || item.recommendedAction === "PENDING_DATA"
    ).length
  };

  return (
    <div className="viewStack">
      <section className="runBar">
        <div>
          <span className="sectionKicker">DETERMINISTIC ENGINE</span>
          <strong>Chạy bottom-up: Ad → Ad set → Campaign</strong>
          <small>
            {project.facts.length.toLocaleString("vi-VN")} fact rows ·{" "}
            {project.rules.filter((rule) => rule.enabled).length} rules enabled
          </small>
          {source.kind === "GOOGLE_SHEETS" && (
            <small>
              Google Sheets ·{" "}
              {source.autoSyncEnabled
                ? `tự refresh mỗi ${source.syncIntervalMinutes} phút khi tool đang mở`
                : "auto refresh đang tắt"}
              {source.lastSyncedAt ? ` · lần cuối ${new Date(source.lastSyncedAt).toLocaleString("vi-VN")}` : " · chưa refresh"}
            </small>
          )}
        </div>
        <label>
          As-of date
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
        </label>
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
        <article>
          <span className="metricIcon red">
            <XCircle size={18} />
          </span>
          <div>
            <small>Cần tắt</small>
            <strong>{counts.TURN_OFF}</strong>
            <em>ads / ad sets / camps</em>
          </div>
        </article>
        <article>
          <span className="metricIcon green">
            <CircleDollarSign size={18} />
          </span>
          <div>
            <small>Invest thêm</small>
            <strong>{counts.INCREASE_BUDGET}</strong>
            <em>budget owners</em>
          </div>
        </article>
        <article>
          <span className="metricIcon blue">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <small>Giữ</small>
            <strong>{counts.KEEP}</strong>
            <em>đang đạt rule</em>
          </div>
        </article>
        <article>
          <span className="metricIcon amber">
            <AlertTriangle size={18} />
          </span>
          <div>
            <small>Cần review/data</small>
            <strong>{counts.REVIEW}</strong>
            <em>không auto-decide</em>
          </div>
        </article>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader filtersHeader">
          <div>
            <span className="sectionKicker">LATEST RUN</span>
            <h2>Optimization decisions</h2>
            <p>
              {run
                ? `${new Date(run.runAt).toLocaleString("vi-VN")} · dữ liệu đến ${run.asOfDate ?? "N/A"} · ${run.status} · QC ${run.qc.status}`
                : "Chưa có run."}
            </p>
          </div>
          <div className="filterBar">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm entity…"
            />
            <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
              <option value="ALL">Tất cả cấp</option>
              <option value="CAMPAIGN">Campaign</option>
              <option value="ADSET">Ad set</option>
              <option value="AD">Ad</option>
            </select>
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
              <option value="ALL">Tất cả action</option>
              <option value="TURN_OFF">Turn off</option>
              <option value="INCREASE_BUDGET">Increase</option>
              <option value="DECREASE_BUDGET">Decrease</option>
              <option value="KEEP">Keep</option>
              <option value="PENDING_DATA">Pending data</option>
              <option value="REVIEW_MANUALLY">Manual review</option>
            </select>
          </div>
        </div>
        {run?.classificationSummary && (
          <div className="classificationSummary">
            <span className="included">
              PFM được tối ưu: {run.classificationSummary.pfmIncluded.toLocaleString("vi-VN")} dòng
            </span>
            <span className="excluded">
              Non-PFM đã loại: {run.classificationSummary.nonPfmExcluded.toLocaleString("vi-VN")} dòng
            </span>
            <span className="review">
              Chưa phân loại: {run.classificationSummary.reviewUnclassified.toLocaleString("vi-VN")} dòng
            </span>
          </div>
        )}
        {!run ? (
          <div className="emptyState">
            <Activity size={28} />
            <strong>Chưa có decision</strong>
            <span>Import data, kiểm tra rules, rồi chạy engine.</span>
          </div>
        ) : run.status === "BLOCKED" ? (
          <div className="blockedState">
            <ShieldAlert size={30} />
            <div>
              <strong>Engine đã chặn destructive recommendation</strong>
              {run.qc.issues.map((issue) => (
                <p key={issue.code}>
                  <b>{issue.code}</b> · {issue.message}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <div className="tableScroller">
            <table className="dataTable decisionTable">
              <thead>
                <tr>
                  <th>Entity / scope</th>
                  <th>KPI signal</th>
                  <th>Plan / Cohort / Context</th>
                  <th>Action</th>
                  <th>Adjust</th>
                  <th>Confidence</th>
                  <th>Rule / reason</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={`${item.scopeId}-${item.entityLevel}-${item.entityId}`}>
                    <td>
                      <span className={`levelPill ${item.entityLevel.toLowerCase()}`}>{item.entityLevel}</span>
                      <strong>{item.entityName}</strong>
                      <small>{item.scopeName}</small>
                      <small className="mono">{item.entityId}</small>
                    </td>
                    <td className="mono">
                      {formatNumber(
                        item.currentMetric,
                        project.config.primaryMetricKey === "ROAS" ||
                          ["CTR", "CVR"].includes(project.config.primaryMetricKey)
                          ? undefined
                          : project.config.currency
                      )}
                      <small>
                        Target{" "}
                        {formatNumber(
                          item.targetMetric,
                          ["ROAS", "CTR", "CVR"].includes(project.config.primaryMetricKey)
                            ? undefined
                            : project.config.currency
                        )}
                      </small>
                    </td>
                    <td className="mono">
                      {item.weightedAchievement === null ? "N/A" : `${Math.round(item.weightedAchievement * 100)}%`}
                      <small>
                        Cohort{" "}
                        {item.cohortWeightedAchievement === null
                          ? "N/A"
                          : `${Math.round(item.cohortWeightedAchievement * 100)}%`}{" "}
                        · Context{" "}
                        {item.contextWeightedAchievement === null
                          ? "N/A"
                          : `${Math.round(item.contextWeightedAchievement * 100)}%`}
                      </small>
                    </td>
                    <td>
                      <span className={`actionPill action-${item.recommendedAction.toLowerCase()}`}>
                        {actionLabel(item.recommendedAction)}
                      </span>
                    </td>
                    <td className="mono">
                      {item.adjustmentPct === null
                        ? "—"
                        : `${item.adjustmentPct > 0 ? "+" : ""}${Math.round(item.adjustmentPct * 100)}%`}
                    </td>
                    <td>
                      <span className="confidenceBar">
                        <i style={{ width: `${item.confidence * 100}%` }} />
                      </span>
                      <small>{Math.round(item.confidence * 100)}%</small>
                    </td>
                    <td>
                      <strong className="mono smallText">{item.matchedRuleIds.join(", ") || "—"}</strong>
                      <small>{item.reasonCodes.join(" · ")}</small>
                    </td>
                    <td>
                      <button
                        className="iconAction"
                        onClick={() => setSelected(item)}
                        aria-label={`Xem evidence ${item.entityName}`}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div className="modalBackdrop drawerBackdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <aside
            className="evidenceDrawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalTitle">
              <div>
                <span className="sectionKicker">
                  {selected.entityLevel} · {selected.scopeName}
                </span>
                <h2 id="evidence-title">{selected.entityName}</h2>
                <p className="mono">{selected.entityId}</p>
              </div>
              <button className="iconAction" onClick={() => setSelected(null)} aria-label="Đóng">
                <X size={18} />
              </button>
            </div>
            <div className="evidenceSummary">
              <span className={`actionPill action-${selected.recommendedAction.toLowerCase()}`}>
                {actionLabel(selected.recommendedAction)}
              </span>
              <strong>
                {selected.adjustmentPct === null
                  ? ""
                  : `${selected.adjustmentPct > 0 ? "+" : ""}${Math.round(selected.adjustmentPct * 100)}%`}
              </strong>
              <p>{selected.reasonCodes.join(" · ")}</p>
            </div>
            <dl className="evidenceList">
              <div>
                <dt>KPI today</dt>
                <dd>{formatNumber(selected.currentMetric)}</dd>
              </div>
              <div>
                <dt>Target</dt>
                <dd>{formatNumber(selected.targetMetric)}</dd>
              </div>
              <div>
                <dt>Plan geometric</dt>
                <dd>
                  {selected.weightedAchievement === null
                    ? "N/A"
                    : `${Math.round(selected.weightedAchievement * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Cohort geometric</dt>
                <dd>
                  {selected.cohortWeightedAchievement === null
                    ? "N/A"
                    : `${Math.round(selected.cohortWeightedAchievement * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Cohort benchmark</dt>
                <dd>{formatNumber(selected.cohortBenchmark)}</dd>
              </div>
              <div>
                <dt>Project / parent context</dt>
                <dd>
                  {selected.contextWeightedAchievement === null
                    ? "N/A"
                    : `${Math.round(selected.contextWeightedAchievement * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Window thấp nhất</dt>
                <dd>
                  {selected.minimumWindowAchievement === null
                    ? "N/A"
                    : `${Math.round(selected.minimumWindowAchievement * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Trend signal / baseline</dt>
                <dd>{selected.trendRatio === null ? "N/A" : `${Math.round(selected.trendRatio * 100)}%`}</dd>
              </div>
              <div>
                <dt>Red flag windows</dt>
                <dd>{selected.redFlagWindowIds.length ? selected.redFlagWindowIds.join(", ") : "Không"}</dd>
              </div>
              <div>
                <dt>Evaluated value</dt>
                <dd>{formatNumber(selected.evaluatedValue)}</dd>
              </div>
              <div>
                <dt>Evidence window</dt>
                <dd>{selected.evidenceWindow}</dd>
              </div>
              <div>
                <dt>Budget type</dt>
                <dd>{selected.budgetType}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.currentStatus}</dd>
              </div>
              <div>
                <dt>Execution phase</dt>
                <dd>{selected.executionPhase}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round(selected.confidence * 100)}%</dd>
              </div>
            </dl>
            {selected.windowMetrics && selected.windowMetrics.length > 0 && (
              <div className="windowEvidence">
                <strong>Performance theo time window</strong>
                <div className="tableScroller">
                  <table className="dataTable compactTable">
                    <thead>
                      <tr>
                        <th>Window</th>
                        <th>Khoảng ngày</th>
                        <th>KPI</th>
                        <th>Achievement</th>
                        <th>Spend</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.windowMetrics.map((window) => (
                        <tr key={window.id}>
                          <td>
                            <strong>{window.label || window.id}</strong>
                            <small>
                              {window.includeInScore ? `Tính điểm · ${window.role}` : `Bổ trợ · ${window.role}`}
                            </small>
                          </td>
                          <td className="mono smallText">
                            {window.start} → {window.endExclusive}
                          </td>
                          <td className="mono">
                            {formatNumber(
                              window.value,
                              ["ROAS", "CTR", "CVR"].includes(project.config.primaryMetricKey)
                                ? undefined
                                : project.config.currency
                            )}
                          </td>
                          <td className="mono">
                            {window.achievement === null ? "N/A" : `${Math.round(window.achievement * 100)}%`}
                          </td>
                          <td className="mono">{formatNumber(window.spend, project.config.currency)}</td>
                          <td className="mono">{formatNumber(window.result)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="ruleTrace">
              <strong>Matched rules</strong>
              {selected.matchedRuleIds.length ? (
                selected.matchedRuleIds.map((id) => <code key={id}>{id}</code>)
              ) : (
                <span>Không có rule match</span>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
