"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Hourglass,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  XCircle
} from "lucide-react";
import type { ActionEvent, ActionRecord, ApprovalStatus } from "@/core/actions";
import { apiJson } from "@/product/api";
import type { TeamApi } from "@/product/team-api";
import type { LocalProject, OptimizationRun } from "@/product/types";
import { actionLabel, formatNumber, latestRun } from "../helpers/format-utils";
import { achievementBand, formatCount, formatPercent, reasonSentence } from "../helpers/reason-labels";
import { PlanOverview } from "./plan-overview";
import type { RecommendationView, SourceSyncResponse } from "./decision-types";

export type OperationsViewProps = {
  project: LocalProject;
  onProjectChange: (project: LocalProject) => void;
  teamApi: TeamApi | null;
  toast: (message: string, tone?: "info" | "success" | "error") => void;
  operatorName?: string;
  onSync?: () => Promise<SourceSyncResponse | null>;
  onAnalyzeAction?: (actionId: string) => void;
};

type StatusFilter = "ALL" | "TODO" | "DONE";
type ActionFilter = "ALL" | "NEEDS_ACTION" | ActionRecord["recommendedAction"];

const PAGE_SIZE = 60;
const entityKey = (scopeId: string, level: string, id: string) => `${scopeId}|${level}|${id}`;

export function OperationsView({
  project,
  onProjectChange,
  teamApi,
  toast,
  operatorName = "",
  onSync,
  onAnalyzeAction
}: OperationsViewProps) {
  const latestFactDate = project.facts.reduce<string | null>(
    (latest, fact) => (!latest || fact.date > latest ? fact.date : latest),
    null
  );
  const [asOfDate, setAsOfDate] = useState(latestFactDate ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [level, setLevel] = useState<"ALL" | "CAMPAIGN" | "ADSET" | "AD">("ALL");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [note, setNote] = useState("");

  const run = latestRun(project);
  const recommendations = useMemo(() => (run?.recommendations ?? []) as RecommendationView[], [run]);
  const summaries = run?.summaries ?? [];
  const source = project.config.dataSource;
  const canSync = source.kind === "GOOGLE_SHEETS" && Boolean(onSync);

  /**
   * One open action per entity. The queue used to live on its own screen, so
   * the same entity could show a decision here and a stale pending action
   * there with no way to line them up.
   */
  const openActionByEntity = useMemo(() => {
    const map = new Map<string, ActionRecord>();
    [...project.actions]
      .filter((action) => action.approvalStatus === "PENDING" || action.approvalStatus === "DEFERRED")
      .sort((a, b) => b.runAt.localeCompare(a.runAt))
      .forEach((action) => {
        const key = entityKey(action.scopeId, action.entityLevel, action.entityId);
        if (!map.has(key)) map.set(key, action);
      });
    return map;
  }, [project.actions]);

  const settledActionByEntity = useMemo(() => {
    const map = new Map<string, ActionRecord>();
    [...project.actions]
      .filter((action) => action.approvalStatus === "DONE" || action.approvalStatus === "REJECTED")
      .sort((a, b) => b.runAt.localeCompare(a.runAt))
      .forEach((action) => {
        const key = entityKey(action.scopeId, action.entityLevel, action.entityId);
        if (!map.has(key)) map.set(key, action);
      });
    return map;
  }, [project.actions]);

  type Row = { decision: RecommendationView; action: ActionRecord | null; settled: ActionRecord | null };

  const rows: Row[] = useMemo(() => recommendations.map((decision) => {
    const key = entityKey(decision.scopeId, decision.entityLevel, decision.entityId);
    return {
      decision,
      action: openActionByEntity.get(key) ?? null,
      settled: settledActionByEntity.get(key) ?? null
    };
  }), [recommendations, openActionByEntity, settledActionByEntity]);

  const needsAction = (row: Row) =>
    row.decision.recommendedAction !== "KEEP" && row.decision.recommendedAction !== "PENDING_DATA";

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (level !== "ALL" && row.decision.entityLevel !== level) return false;
      if (actionFilter === "NEEDS_ACTION" && !needsAction(row)) return false;
      if (actionFilter !== "ALL" && actionFilter !== "NEEDS_ACTION"
        && row.decision.recommendedAction !== actionFilter) return false;
      if (statusFilter === "TODO" && !(needsAction(row) && !row.settled)) return false;
      if (statusFilter === "DONE" && !row.settled) return false;
      if (query && !`${row.decision.entityName} ${row.decision.entityId}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rows, level, actionFilter, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const counts = {
    TURN_OFF: recommendations.filter((item) => item.recommendedAction === "TURN_OFF").length,
    BUDGET: recommendations.filter(
      (item) => item.recommendedAction === "INCREASE_BUDGET" || item.recommendedAction === "DECREASE_BUDGET"
    ).length,
    KEEP: recommendations.filter((item) => item.recommendedAction === "KEEP").length,
    REVIEW: recommendations.filter((item) => item.recommendedAction === "REVIEW_MANUALLY").length,
    PENDING_DATA: recommendations.filter((item) => item.recommendedAction === "PENDING_DATA").length
  };
  const todoCount = rows.filter((row) => needsAction(row) && !row.settled).length;

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
      else toast(`Engine hoàn tất: ${output.recommendations.length} quyết định · ${newActions.length} việc mới.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Engine run thất bại.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: ActionRecord, to: ApprovalStatus, noteText: string | null) {
    const valid: Record<ApprovalStatus, ApprovalStatus[]> = {
      PENDING: ["DONE", "REJECTED", "DEFERRED"],
      DEFERRED: ["PENDING", "DONE", "REJECTED"],
      DONE: [],
      REJECTED: []
    };
    if (!valid[action.approvalStatus].includes(to))
      return toast(`Không chuyển được ${action.approvalStatus} sang ${to}.`, "error");
    const at = new Date().toISOString();
    const actor = operatorName.trim() || "Media Buyer";
    const event: ActionEvent = {
      id: crypto.randomUUID(),
      actionId: action.id,
      at,
      actor,
      from: action.approvalStatus,
      to,
      note: noteText
    };
    if (teamApi) {
      try {
        await teamApi(
          `/api/projects/${encodeURIComponent(project.config.projectId)}/actions/${encodeURIComponent(action.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to, at, note: noteText })
          }
        );
      } catch (error) {
        return toast(error instanceof Error ? error.message : "ACTION_UPDATE_FAILED", "error");
      }
    }
    onProjectChange({
      ...project,
      actions: project.actions.map((item) =>
        item.id === action.id
          ? { ...item, approvalStatus: to, reviewer: actor, executedAt: to === "DONE" ? at : item.executedAt, note: noteText }
          : item
      ),
      actionLog: [event, ...project.actionLog],
      updatedAt: at
    });
    toast(to === "DONE" ? "Đã đánh dấu hoàn tất." : to === "REJECTED" ? "Đã từ chối đề xuất." : "Đã hoãn lại.", "success");
  }

  const isMoneyMetric = !["ROAS", "CTR", "CVR"].includes(project.config.primaryMetricKey);
  const money = (value: number | null | undefined) =>
    formatNumber(value ?? null, isMoneyMetric ? project.config.currency : undefined);

  const selectedRow = selected
    ? rows.find((row) => entityKey(row.decision.scopeId, row.decision.entityLevel, row.decision.entityId)
        === entityKey(selected.scopeId, selected.entityLevel, selected.entityId)) ?? null
    : null;

  return (
    <div className="viewStack">
      <section className="runBar">
        <div>
          <span className="sectionKicker">ENGINE</span>
          <strong>Chạy bottom-up: Ad → Ad set → Campaign</strong>
          <small>
            {project.facts.length.toLocaleString("vi-VN")} dòng dữ liệu ·{" "}
            {project.rules.filter((rule) => rule.enabled).length} rule đang bật
            {run ? ` · chạy lúc ${new Date(run.runAt).toLocaleString("vi-VN")}` : " · chưa chạy lần nào"}
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
          Dữ liệu đến ngày
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
        </label>
        {canSync && (
          <button className="secondaryAction large" onClick={() => void refreshSource()} disabled={syncing || busy}>
            <RefreshCw className={syncing ? "spin" : ""} size={17} />
            {syncing ? "Đang refresh…" : source.autoRunAfterSync ? "Refresh & chạy lại" : "Refresh data"}
          </button>
        )}
        <button className="primaryAction large" onClick={executeRun} disabled={busy || syncing}>
          {busy ? <RefreshCw className="spin" size={17} /> : <Play size={17} />}
          {busy ? "Đang chạy…" : "Chạy tối ưu"}
        </button>
      </section>

      {summaries.map((summary) => {
        const scope = project.config.optimizationScopes.find((item) => item.scopeId === summary.scopeId);
        return (
          <PlanOverview
            key={summary.scopeId}
            summary={summary}
            config={project.config}
            contextWeights={project.config.contextWeights.AD}
            contextSource={scope?.contextSource ?? "PARENT"}
            accountAchievement={summary.achievement}
            windowWeights={(scope?.windows ?? project.config.windows).map((window) => ({
              id: window.id,
              label: window.label ?? window.id,
              weight: window.includeInScore ? window.weight : 0
            }))}
          />
        );
      })}

      <section className="metricStrip">
        <article>
          <span className="metricIcon red"><XCircle size={18} /></span>
          <div><small>Cần tắt</small><strong>{counts.TURN_OFF}</strong><em>ad / ad set / campaign</em></div>
        </article>
        <article>
          <span className="metricIcon green"><CircleDollarSign size={18} /></span>
          <div><small>Đổi ngân sách</small><strong>{counts.BUDGET}</strong><em>cấp giữ ngân sách</em></div>
        </article>
        <article>
          <span className="metricIcon blue"><CheckCircle2 size={18} /></span>
          <div><small>Giữ nguyên</small><strong>{counts.KEEP}</strong><em>đang đạt ngưỡng</em></div>
        </article>
        <article>
          <span className="metricIcon amber"><AlertTriangle size={18} /></span>
          <div><small>Cần review tay</small><strong>{counts.REVIEW}</strong><em>engine không tự quyết</em></div>
        </article>
        <article>
          <span className="metricIcon teal"><Hourglass size={18} /></span>
          <div><small>Chưa đủ dữ liệu</small><strong>{counts.PENDING_DATA}</strong><em>chờ thêm bằng chứng</em></div>
        </article>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader filtersHeader">
          <div>
            <span className="sectionKicker">QUYẾT ĐỊNH VÀ THỰC THI</span>
            <h2>Bảng điều hành</h2>
            <p>
              {run
                ? `Dữ liệu đến ${run.asOfDate ?? "N/A"} · QC ${run.qc.status} · còn ${todoCount} việc chưa xử lý`
                : "Chưa có lần chạy nào."}
              {" "}V1 không gọi Meta API: thao tác trong Ads Manager rồi đánh dấu lại ở đây.
            </p>
          </div>
          <div className="filterBar">
            <label className="compactSearch">
              <Search size={15} />
              <input
                type="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="Tìm entity…"
              />
            </label>
            <select value={level} onChange={(event) => { setLevel(event.target.value as typeof level); setPage(1); }}>
              <option value="ALL">Tất cả cấp</option>
              <option value="CAMPAIGN">Campaign</option>
              <option value="ADSET">Ad set</option>
              <option value="AD">Ad</option>
            </select>
            <select value={actionFilter} onChange={(event) => { setActionFilter(event.target.value as ActionFilter); setPage(1); }}>
              <option value="ALL">Tất cả đề xuất</option>
              <option value="NEEDS_ACTION">Cần làm gì đó</option>
              <option value="TURN_OFF">Tắt</option>
              <option value="DECREASE_BUDGET">Giảm ngân sách</option>
              <option value="INCREASE_BUDGET">Tăng ngân sách</option>
              <option value="KEEP">Giữ</option>
              <option value="REVIEW_MANUALLY">Review tay</option>
              <option value="PENDING_DATA">Chưa đủ dữ liệu</option>
            </select>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setPage(1); }}>
              <option value="ALL">Mọi trạng thái</option>
              <option value="TODO">Chưa xử lý</option>
              <option value="DONE">Đã xử lý</option>
            </select>
          </div>
        </div>

        {run?.classificationSummary && (
          <div className="classificationSummary">
            <span className="included">Được tối ưu: {run.classificationSummary.pfmIncluded.toLocaleString("vi-VN")} dòng</span>
            <span className="excluded">Đã loại: {run.classificationSummary.nonPfmExcluded.toLocaleString("vi-VN")} dòng</span>
            <span className="review">Chưa phân loại: {run.classificationSummary.reviewUnclassified.toLocaleString("vi-VN")} dòng</span>
          </div>
        )}

        {!run ? (
          <div className="emptyState">
            <Activity size={28} />
            <strong>Chưa có quyết định nào</strong>
            <span>Import dữ liệu, kiểm tra rule, rồi bấm Chạy tối ưu.</span>
          </div>
        ) : run.status === "BLOCKED" ? (
          <div className="blockedState">
            <ShieldAlert size={30} />
            <div>
              <strong>Engine đã chặn để không tạo ra hành động sai</strong>
              {run.qc.issues.map((issue) => <p key={issue.code}><b>{issue.code}</b> · {issue.message}</p>)}
            </div>
          </div>
        ) : !filtered.length ? (
          <div className="emptyState">
            <Activity size={28} />
            <strong>Không có dòng nào khớp bộ lọc</strong>
            <span>Đổi bộ lọc hoặc xoá từ khoá tìm kiếm.</span>
          </div>
        ) : (
          <div className="tableScroller">
            <table className="dataTable decisionTable stickyTable">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>KPI hôm nay</th>
                  <th>Điểm đạt target</th>
                  <th>Đề xuất</th>
                  <th>Lý do</th>
                  <th>Xử lý</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {paged.map(({ decision, action, settled }) => {
                  const band = achievementBand(decision.blendedAchievement ?? decision.weightedAchievement);
                  return (
                    <tr key={entityKey(decision.scopeId, decision.entityLevel, decision.entityId)}>
                      <td>
                        <span className={`levelPill ${decision.entityLevel.toLowerCase()}`}>{decision.entityLevel}</span>
                        <strong>{decision.entityName}</strong>
                        <small className="mono">{decision.entityId}</small>
                      </td>
                      <td className="mono">
                        {money(decision.currentMetric)}
                        <small>Target {money(decision.targetMetric)}</small>
                      </td>
                      <td>
                        <span className={`scoreValue band-${band}`}>
                          {formatPercent(decision.blendedAchievement ?? decision.weightedAchievement)}
                        </span>
                        <span className="scoreMeter" aria-hidden="true">
                          <i
                            className={`band-${band}`}
                            style={{
                              width: `${Math.min(100, Math.max(0, ((decision.blendedAchievement ?? decision.weightedAchievement) ?? 0) / 1.5 * 100))}%`
                            }}
                          />
                          <u />
                        </span>
                        <small>
                          {decision.blendedAchievement !== undefined
                            && decision.blendedAchievement !== null
                            && decision.blendedAchievement !== decision.weightedAchievement
                            ? `riêng entity ${formatPercent(decision.weightedAchievement)}`
                            : decision.cohortRank && decision.cohortSize
                              ? `hạng ${decision.cohortRank}/${decision.cohortSize} tài khoản`
                              : ""}
                        </small>
                      </td>
                      <td>
                        <span className={`actionPill action-${decision.recommendedAction.toLowerCase()}`}>
                          {actionLabel(decision.recommendedAction)}
                        </span>
                        {decision.adjustmentPct !== null && (
                          <small className="mono">
                            {decision.adjustmentPct > 0 ? "+" : ""}{Math.round(decision.adjustmentPct * 100)}%
                          </small>
                        )}
                      </td>
                      <td className="reasonCell">{reasonSentence(decision.reasonCodes)}</td>
                      <td>
                        {settled ? (
                          <span className={`statusBadge status-${settled.approvalStatus.toLowerCase()}`}>
                            {settled.approvalStatus === "DONE" ? "Đã làm" : "Đã từ chối"}
                          </span>
                        ) : action ? (
                          <div className="rowActions">
                            <button className="primaryAction small" onClick={() => void transition(action, "DONE", null)}>
                              Đã làm
                            </button>
                            <button className="secondaryAction small" onClick={() => void transition(action, "DEFERRED", null)}>
                              Hoãn
                            </button>
                            <button className="dangerAction small" onClick={() => void transition(action, "REJECTED", null)}>
                              Bỏ
                            </button>
                          </div>
                        ) : (
                          <span className="mutedCell">—</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="iconAction"
                          onClick={() => { setSelected(decision); setNote(action?.note ?? ""); }}
                          aria-label={`Xem bằng chứng ${decision.entityName}`}
                        >
                          <ChevronRight size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="paginationBar">
            <span>{filtered.length.toLocaleString("vi-VN")} dòng · Trang {safePage}/{pageCount}</span>
            <div>
              <button className="secondaryAction small" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trước</button>
              <button className="secondaryAction small" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Sau</button>
            </div>
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
                <span className="sectionKicker">{selected.entityLevel} · {selected.scopeName}</span>
                <h2 id="evidence-title">{selected.entityName}</h2>
                <p className="mono">{selected.entityId}</p>
              </div>
              <button className="iconAction" onClick={() => setSelected(null)} aria-label="Đóng"><X size={18} /></button>
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
              <p>{reasonSentence(selected.reasonCodes)}</p>
            </div>

            {selectedRow?.action && (
              <div className="drawerActionBar">
                <label className="modalTextarea">
                  Ghi chú
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Đã kiểm tra Ads Manager / lý do từ chối / thời điểm xem lại…"
                  />
                </label>
                <div className="modalActions spread">
                  <button className="dangerAction" onClick={() => { void transition(selectedRow.action!, "REJECTED", note || null); setSelected(null); }}>
                    Bỏ đề xuất
                  </button>
                  <button className="secondaryAction" onClick={() => { void transition(selectedRow.action!, "DEFERRED", note || null); setSelected(null); }}>
                    Hoãn
                  </button>
                  <button className="primaryAction" onClick={() => { void transition(selectedRow.action!, "DONE", note || null); setSelected(null); }}>
                    <CheckCircle2 size={16} /> Đã làm xong
                  </button>
                </div>
              </div>
            )}

            {onAnalyzeAction && selectedRow?.action && (
              <button className="secondaryAction fullWidthAction" onClick={() => onAnalyzeAction(selectedRow.action!.id)}>
                <Sparkles size={16} /> Phân tích thêm bằng AI
              </button>
            )}

            <dl className="evidenceList">
              <div><dt>KPI hôm nay</dt><dd>{money(selected.currentMetric)}</dd></div>
              <div><dt>Target</dt><dd>{money(selected.targetMetric)}</dd></div>
              <div><dt>Điểm riêng entity</dt><dd>{formatPercent(selected.weightedAchievement)}</dd></div>
              <div><dt>Điểm gộp (dùng để quyết định)</dt><dd>{formatPercent(selected.blendedAchievement)}</dd></div>
              <div><dt>Điểm nhóm cấp trên</dt><dd>{formatPercent(selected.contextWeightedAchievement)}</dd></div>
              <div>
                <dt>Hạng trong tài khoản</dt>
                <dd>{selected.cohortRank && selected.cohortSize ? `${selected.cohortRank}/${selected.cohortSize}` : "N/A"}</dd>
              </div>
              <div><dt>Mặt bằng nhóm ngang hàng</dt><dd>{money(selected.cohortBenchmark)}</dd></div>
              <div><dt>Cửa sổ yếu nhất</dt><dd>{formatPercent(selected.minimumWindowAchievement)}</dd></div>
              <div><dt>Xu hướng gần đây</dt><dd>{formatPercent(selected.trendRatio)}</dd></div>
              <div><dt>Độ dày dữ liệu</dt><dd>{formatPercent(selected.confidence)}</dd></div>
              <div><dt>Loại ngân sách</dt><dd>{selected.budgetType}</dd></div>
              <div><dt>Trạng thái entity</dt><dd>{selected.currentStatus}</dd></div>
              <div><dt>Thứ tự thực thi</dt><dd>{selected.executionPhase}</dd></div>
            </dl>

            {selected.windowMetrics && selected.windowMetrics.length > 0 && (
              <div className="windowEvidence">
                <strong>Hiệu suất theo từng cửa sổ</strong>
                <div className="tableScroller">
                  <table className="dataTable compactTable">
                    <thead>
                      <tr><th>Cửa sổ</th><th>Khoảng ngày</th><th>KPI</th><th>Đạt</th><th>Chi tiêu</th><th>Result</th></tr>
                    </thead>
                    <tbody>
                      {selected.windowMetrics.map((window) => (
                        <tr key={window.id}>
                          <td>
                            <strong>{window.label || window.id}</strong>
                            <small>{window.includeInScore ? "Tính điểm" : "Chỉ tham khảo"}</small>
                          </td>
                          <td className="mono smallText">{window.start} → {window.endExclusive}</td>
                          <td className="mono">{money(window.value)}</td>
                          <td className="mono">
                            <span className={`bandPill band-${achievementBand(window.achievement)}`}>
                              {formatPercent(window.achievement)}
                            </span>
                          </td>
                          <td className="mono">{formatNumber(window.spend, project.config.currency)}</td>
                          <td className="mono">{formatCount(window.result)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="ruleTrace">
              <strong>Mã rule và mã lý do</strong>
              {selected.matchedRuleIds.length
                ? selected.matchedRuleIds.map((id) => <code key={id}>{id}</code>)
                : <span>Không có rule nào khớp</span>}
              {selected.reasonCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
