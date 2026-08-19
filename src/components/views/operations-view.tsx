"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  CircleDollarSign,
  Hourglass,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  XCircle,
  AlertTriangle
} from "lucide-react";
import type { ActionEvent, ActionRecord, ApprovalStatus } from "@/core/actions";
import { apiJson } from "@/product/api";
import type { TeamApi } from "@/product/team-api";
import type { LocalProject, OptimizationRun } from "@/product/types";
import { actionLabel, formatNumber, latestRun } from "../helpers/format-utils";
import { achievementBand, formatCount, formatPercent, reasonSentence } from "../helpers/reason-labels";
import { causeLabel, readEvidence } from "../helpers/diagnostics";
import { NotchMeter, WindowTrail } from "../helpers/meters";
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
type ActionFilter = "ALL" | ActionRecord["recommendedAction"] | "BUDGET";

const PAGE_SIZE = 60;
const entityKey = (scopeId: string, level: string, id: string) => `${scopeId}|${level}|${id}`;

/**
 * The counters double as the primary filter. Reading "49 cần tắt" and then
 * hunting for them in a 998-row table was the slowest step of the old flow.
 */
const CHIPS: Array<{
  id: ActionFilter;
  label: string;
  hint: string;
  tone: string;
  icon: typeof XCircle;
}> = [
  { id: "TURN_OFF", label: "Cần tắt", hint: "đang đốt tiền dưới ngưỡng", tone: "off", icon: XCircle },
  { id: "BUDGET", label: "Đổi ngân sách", hint: "cấp giữ ngân sách", tone: "scale", icon: CircleDollarSign },
  { id: "KEEP", label: "Giữ nguyên", hint: "đang đạt ngưỡng", tone: "keep", icon: CheckCircle2 },
  { id: "REVIEW_MANUALLY", label: "Review tay", hint: "engine không tự quyết", tone: "watch", icon: AlertTriangle },
  { id: "PENDING_DATA", label: "Chưa đủ dữ liệu", hint: "chưa kết luận được", tone: "idle", icon: Hourglass }
];

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
  const [scopeFilter, setScopeFilter] = useState("ALL");
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
  const multiScope = summaries.length > 1;

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

  const scopeRows = useMemo(
    () => (scopeFilter === "ALL" ? rows : rows.filter((row) => row.decision.scopeId === scopeFilter)),
    [rows, scopeFilter]
  );

  const needsAction = (row: Row) =>
    row.decision.recommendedAction !== "KEEP" && row.decision.recommendedAction !== "PENDING_DATA";

  const matchesChip = (row: Row, chip: ActionFilter) => {
    if (chip === "ALL") return true;
    if (chip === "BUDGET") {
      return row.decision.recommendedAction === "INCREASE_BUDGET"
        || row.decision.recommendedAction === "DECREASE_BUDGET";
    }
    return row.decision.recommendedAction === chip;
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return scopeRows.filter((row) => {
      if (level !== "ALL" && row.decision.entityLevel !== level) return false;
      if (!matchesChip(row, actionFilter)) return false;
      if (statusFilter === "TODO" && !(needsAction(row) && !row.settled)) return false;
      if (statusFilter === "DONE" && !row.settled) return false;
      if (query && !`${row.decision.entityName} ${row.decision.entityId}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [scopeRows, level, actionFilter, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const chipCount = (chip: ActionFilter) => scopeRows.filter((row) => matchesChip(row, chip)).length;
  const todoCount = scopeRows.filter((row) => needsAction(row) && !row.settled).length;

  // An entity that spent money and returned zero of the metric being scored is
  // not thin data — it is the wrong metric. That distinction decides whether
  // "Cần tắt" is a real instruction or a false alarm, so it goes above the table.
  const evidenceByEntity = useMemo(() => {
    const map = new Map<string, ReturnType<typeof readEvidence>>();
    scopeRows.forEach((row) => {
      map.set(
        entityKey(row.decision.scopeId, row.decision.entityLevel, row.decision.entityId),
        readEvidence(row.decision.windowMetrics)
      );
    });
    return map;
  }, [scopeRows]);

  const evidenceOf = (decision: RecommendationView) =>
    evidenceByEntity.get(entityKey(decision.scopeId, decision.entityLevel, decision.entityId));

  const blindSpots = useMemo(() => {
    const hits = scopeRows.filter(
      (row) => evidenceOf(row.decision)?.cause === "SPENT_NO_RESULT"
    );
    return {
      count: hits.length,
      spend: hits.reduce((total, row) => total + (evidenceOf(row.decision)?.spend ?? 0), 0),
      turnOff: hits.filter((row) => row.decision.recommendedAction === "TURN_OFF").length
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeRows, evidenceByEntity]);

  const eventLabel = summaries[0]?.optimizationEventLabel ?? project.config.optimizationEventLabel;

  // Repeating one target on 998 rows is noise, but scopes can have different
  // targets, so it only belongs in the header when every visible row shares it.
  const targets = new Set(scopeRows.map((row) => row.decision.targetMetric));
  const rowTarget = targets.size === 1 ? [...targets][0] : null;
  const isMoneyMetric = !["ROAS", "CTR", "CVR"].includes(project.config.primaryMetricKey);
  const money = (value: number | null | undefined) =>
    formatNumber(value ?? null, isMoneyMetric ? project.config.currency : undefined);

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
    if (!project.facts.length) return toast("Chưa có dữ liệu. Hãy import trước.", "error");
    if (!project.rules.some((rule) => rule.enabled)) return toast("Không có rule nào đang bật.", "error");
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
      else toast(`Xong: ${output.recommendations.length} quyết định · ${newActions.length} việc mới.`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Chạy engine thất bại.", "error");
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
      id: crypto.randomUUID(), actionId: action.id, at, actor,
      from: action.approvalStatus, to, note: noteText
    };
    if (teamApi) {
      try {
        await teamApi(
          `/api/projects/${encodeURIComponent(project.config.projectId)}/actions/${encodeURIComponent(action.id)}`,
          { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, at, note: noteText }) }
        );
      } catch (error) {
        return toast(error instanceof Error ? error.message : "Cập nhật thất bại.", "error");
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
    toast(to === "DONE" ? "Đã đánh dấu hoàn tất." : to === "REJECTED" ? "Đã bỏ đề xuất." : "Đã hoãn.", "success");
  }

  const selectedRow = selected
    ? rows.find((row) => entityKey(row.decision.scopeId, row.decision.entityLevel, row.decision.entityId)
        === entityKey(selected.scopeId, selected.entityLevel, selected.entityId)) ?? null
    : null;

  function openRow(row: Row) {
    setSelected(row.decision);
    setNote(row.action?.note ?? "");
  }

  return (
    <div className="viewStack opsView">
      <section className="commandBar">
        <div className="commandMeta">
          <strong>{project.facts.length.toLocaleString("vi-VN")} dòng dữ liệu</strong>
          <span>
            {run ? `chạy lúc ${new Date(run.runAt).toLocaleString("vi-VN")}` : "chưa chạy lần nào"}
            {run ? ` · dữ liệu đến ${run.asOfDate ?? "N/A"}` : ""}
            {source.kind === "GOOGLE_SHEETS" && source.lastSyncedAt
              ? ` · sheet đồng bộ ${new Date(source.lastSyncedAt).toLocaleTimeString("vi-VN")}`
              : ""}
          </span>
        </div>
        <label className="commandDate">
          Dữ liệu đến
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
        </label>
        {canSync && (
          <button className="secondaryAction" onClick={() => void refreshSource()} disabled={syncing || busy}>
            <RefreshCw className={syncing ? "spin" : ""} size={16} />
            {syncing ? "Đang refresh" : "Refresh"}
          </button>
        )}
        <button className="primaryAction large" onClick={executeRun} disabled={busy || syncing}>
          {busy ? <RefreshCw className="spin" size={17} /> : <Play size={17} />}
          {busy ? "Đang chạy" : "Chạy tối ưu"}
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
            windowWeights={(scope?.windows ?? project.config.windows).map((window) => ({
              id: window.id,
              label: window.label ?? window.id,
              weight: window.includeInScore ? window.weight : 0
            }))}
          />
        );
      })}

      {blindSpots.count > 0 && (
        <section className="blindSpot">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {blindSpots.count.toLocaleString("vi-VN")} dòng đã tiêu {money(blindSpots.spend)} mà
              chưa ra {eventLabel} nào
            </strong>
            <p>
              Nếu những dòng này đang chạy objective khác thì tool đang chấm chúng bằng sai thước đo
              {blindSpots.turnOff > 0 && <>, và {blindSpots.turnOff.toLocaleString("vi-VN")} đề xuất tắt trong số đó không đáng tin</>}.
              Tách mỗi objective thành một nhóm KPI riêng trong Project &amp; KPI trước khi tắt.
            </p>
          </div>
          <button
            className="secondaryAction small"
            onClick={() => { setActionFilter("ALL"); setSearch(""); setPage(1); }}
          >
            Xem tất cả
          </button>
        </section>
      )}

      <section className="sectionCard tableCard">
        <div className="chipRow" role="group" aria-label="Lọc theo đề xuất">
          {CHIPS.map((chip) => {
            const Icon = chip.icon;
            const active = actionFilter === chip.id;
            return (
              <button
                key={chip.id}
                className={`decisionChip band-${chip.tone}${active ? " active" : ""}`}
                aria-pressed={active}
                onClick={() => { setActionFilter(active ? "ALL" : chip.id); setPage(1); }}
              >
                <Icon size={15} />
                <strong>{chipCount(chip.id).toLocaleString("vi-VN")}</strong>
                <span>{chip.label}</span>
                <small>{chip.hint}</small>
              </button>
            );
          })}
        </div>

        <div className="tableHead">
          <div className="tableHeadTitle">
            <h2>Bảng điều hành</h2>
            <p>
              Còn <b>{todoCount.toLocaleString("vi-VN")}</b> việc chưa xử lý
              {rowTarget !== null && <> · target mọi dòng <b>{money(rowTarget)}</b></>}
              {run?.qc.status && <> · QC {run.qc.status}</>}
            </p>
          </div>
          <div className="filterBar">
            <label className="compactSearch">
              <Search size={15} />
              <input
                type="search" value={search} placeholder="Tìm entity…"
                onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              />
            </label>
            {multiScope && (
              <select value={scopeFilter} onChange={(event) => { setScopeFilter(event.target.value); setPage(1); }}>
                <option value="ALL">Tất cả nhóm KPI</option>
                {summaries.map((summary) => (
                  <option key={summary.scopeId} value={summary.scopeId}>{summary.scopeName}</option>
                ))}
              </select>
            )}
            <select value={level} onChange={(event) => { setLevel(event.target.value as typeof level); setPage(1); }}>
              <option value="ALL">Mọi cấp</option>
              <option value="CAMPAIGN">Campaign</option>
              <option value="ADSET">Ad set</option>
              <option value="AD">Ad</option>
            </select>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setPage(1); }}>
              <option value="ALL">Mọi trạng thái</option>
              <option value="TODO">Chưa xử lý</option>
              <option value="DONE">Đã xử lý</option>
            </select>
            {(actionFilter !== "ALL" || statusFilter !== "ALL" || level !== "ALL" || search || scopeFilter !== "ALL") && (
              <button
                className="linkAction"
                onClick={() => {
                  setActionFilter("ALL"); setStatusFilter("ALL"); setLevel("ALL");
                  setSearch(""); setScopeFilter("ALL"); setPage(1);
                }}
              >
                Xoá lọc
              </button>
            )}
          </div>
        </div>

        {!run ? (
          <div className="emptyState">
            <Activity size={28} />
            <strong>Chưa có quyết định nào</strong>
            <span>Import dữ liệu rồi bấm Chạy tối ưu.</span>
          </div>
        ) : run.status === "BLOCKED" ? (
          <div className="blockedState">
            <ShieldAlert size={28} />
            <div>
              <strong>Engine đã chặn để không tạo ra hành động sai</strong>
              {run.qc.issues.map((issue) => <p key={issue.code}>{issue.message}</p>)}
            </div>
          </div>
        ) : !filtered.length ? (
          <div className="emptyState">
            <Activity size={28} />
            <strong>Không có dòng nào khớp bộ lọc</strong>
            <span>Bấm “Xoá lọc” để xem lại toàn bộ.</span>
          </div>
        ) : (
          <div className="tableScroller">
            <table className="opsTable">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th className="numeric">KPI hôm nay</th>
                  <th className="trailCol">Xu hướng</th>
                  <th className="scoreCol">Đạt target</th>
                  <th>Đề xuất</th>
                  <th>Xử lý</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const { decision, action, settled } = row;
                  const score = decision.blendedAchievement ?? decision.weightedAchievement;
                  const band = achievementBand(score);
                  // The band rule is already legible from the score and the action
                  // pill, so only an override earns a line of prose.
                  const overrides = decision.reasonCodes.filter((code) => !code.startsWith("RULE_"));
                  const evidence = evidenceOf(decision);
                  const blind = evidence?.cause === "SPENT_NO_RESULT";
                  return (
                    <tr
                      key={entityKey(decision.scopeId, decision.entityLevel, decision.entityId)}
                      className={`band-edge-${band}`}
                      onClick={() => openRow(row)}
                      tabIndex={0}
                      onKeyDown={(event) => { if (event.key === "Enter") openRow(row); }}
                    >
                      <td className="entityCell">
                        <span className={`levelPill ${decision.entityLevel.toLowerCase()}`}>{decision.entityLevel}</span>
                        <strong>{decision.entityName}</strong>
                        <small className="mono">
                          {[
                            decision.entityId === decision.entityName ? null : decision.entityId,
                            multiScope ? decision.scopeName : null
                          ].filter(Boolean).join(" · ")}
                        </small>
                        {blind && (
                          <em className="evidenceNote">
                            {causeLabel("SPENT_NO_RESULT", eventLabel)} — kiểm tra objective
                          </em>
                        )}
                        {!blind && evidence && evidence.cause !== "HEALTHY"
                          && decision.recommendedAction === "PENDING_DATA" && (
                          <em className="evidenceNote muted">{causeLabel(evidence.cause, eventLabel)}</em>
                        )}
                        {overrides.length > 0 && <em className="overrideNote">{reasonSentence(overrides)}</em>}
                      </td>
                      <td className="numeric mono">{money(decision.currentMetric)}</td>
                      <td className="trailCol">
                        <WindowTrail
                          windows={(decision.windowMetrics ?? []).map((window) => ({
                            id: window.id,
                            label: `${window.label}: ${formatPercent(window.achievement)}`,
                            achievement: window.achievement,
                            includeInScore: window.includeInScore
                          }))}
                        />
                      </td>
                      <td className="scoreCol">
                        <span className={`scoreValue band-${band}`}>{formatPercent(score)}</span>
                        <NotchMeter value={score} />
                      </td>
                      <td>
                        <span className={`actionPill action-${decision.recommendedAction.toLowerCase()}`}>
                          {actionLabel(decision.recommendedAction)}
                          {decision.adjustmentPct !== null
                            && ` ${decision.adjustmentPct > 0 ? "+" : ""}${Math.round(decision.adjustmentPct * 100)}%`}
                        </span>
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {settled ? (
                          <span className={`statusBadge status-${settled.approvalStatus.toLowerCase()}`}>
                            {settled.approvalStatus === "DONE" ? "Đã làm" : "Đã bỏ"}
                          </span>
                        ) : action ? (
                          <div className="rowActions">
                            <button className="primaryAction small" onClick={() => void transition(action, "DONE", null)}>Đã làm</button>
                            <button className="ghostAction small" onClick={() => void transition(action, "DEFERRED", null)}>Hoãn</button>
                            <button className="ghostAction small danger" onClick={() => void transition(action, "REJECTED", null)}>Bỏ</button>
                          </div>
                        ) : (
                          <span className="mutedCell">—</span>
                        )}
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
            <span>{filtered.length.toLocaleString("vi-VN")} dòng · trang {safePage}/{pageCount}</span>
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
            className="evidenceDrawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title"
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

            <div className="drawerVerdict">
              <span className={`actionPill action-${selected.recommendedAction.toLowerCase()}`}>
                {actionLabel(selected.recommendedAction)}
                {selected.adjustmentPct !== null
                  && ` ${selected.adjustmentPct > 0 ? "+" : ""}${Math.round(selected.adjustmentPct * 100)}%`}
              </span>
              <p>{reasonSentence(selected.reasonCodes)}</p>
            </div>

            {evidenceOf(selected)?.cause === "SPENT_NO_RESULT" && (
              <p className="drawerDiagnosis">
                <AlertTriangle size={15} />
                <span>
                  Entity này đã tiêu <b>{money(evidenceOf(selected)?.spend ?? 0)}</b> mà chưa ra
                  {" "}{eventLabel} nào. Kiểm tra objective của nó trước khi làm theo đề xuất —
                  nếu nó chạy objective khác thì đây là sai thước đo, không phải quảng cáo kém.
                </span>
              </p>
            )}

            {selectedRow?.action && (
              <div className="drawerActionBar">
                <label className="modalTextarea">
                  Ghi chú
                  <textarea
                    value={note} onChange={(event) => setNote(event.target.value)}
                    placeholder="Đã thao tác trong Ads Manager / lý do bỏ / khi nào xem lại…"
                  />
                </label>
                <div className="modalActions spread">
                  <button className="ghostAction danger" onClick={() => { void transition(selectedRow.action!, "REJECTED", note || null); setSelected(null); }}>Bỏ đề xuất</button>
                  <button className="secondaryAction" onClick={() => { void transition(selectedRow.action!, "DEFERRED", note || null); setSelected(null); }}>Hoãn</button>
                  <button className="primaryAction" onClick={() => { void transition(selectedRow.action!, "DONE", note || null); setSelected(null); }}>
                    <CheckCircle2 size={16} /> Đã làm xong
                  </button>
                </div>
              </div>
            )}

            {/* A row of "N/A" teaches nothing and buries the numbers that do
                decide the call, so a measure that has no value is not shown. */}
            <dl className="evidenceList">
              {([
                ["KPI hôm nay", money(selected.currentMetric), selected.currentMetric !== null, false],
                ["Target", money(selected.targetMetric), true, false],
                [
                  "Điểm gộp (dùng để quyết định)",
                  formatPercent(selected.blendedAchievement ?? selected.weightedAchievement),
                  (selected.blendedAchievement ?? selected.weightedAchievement) !== null,
                  true
                ],
                ["Điểm riêng entity", formatPercent(selected.weightedAchievement), selected.weightedAchievement !== null, false],
                ["Điểm nhóm cấp trên", formatPercent(selected.contextWeightedAchievement), selected.contextWeightedAchievement !== null, false],
                [
                  "Hạng trong tài khoản",
                  `${selected.cohortRank}/${selected.cohortSize} · mặt bằng ${money(selected.cohortBenchmark)}`,
                  Boolean(selected.cohortRank && selected.cohortSize),
                  false
                ],
                ["Cửa sổ yếu nhất", formatPercent(selected.minimumWindowAchievement), selected.minimumWindowAchievement !== null, false],
                ["Xu hướng gần đây", formatPercent(selected.trendRatio), selected.trendRatio !== null, false],
                ["Độ dày dữ liệu", formatPercent(selected.confidence), true, false],
                ["Loại ngân sách", selected.budgetType, selected.entityLevel !== "AD", false],
                ["Trạng thái entity", selected.currentStatus, true, false]
              ] as Array<[string, string, boolean, boolean]>)
                .filter(([, , show]) => show)
                .map(([label, value, , strong]) => (
                  <div key={label} className={strong ? "strong" : undefined}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>

            {selected.windowMetrics && selected.windowMetrics.length > 0 && (
              <div className="windowEvidence">
                <strong>Hiệu suất theo cửa sổ</strong>
                <table className="dataTable compactTable">
                  <thead>
                    <tr><th>Cửa sổ</th><th>KPI</th><th>Chi tiêu</th><th>Result</th><th>Đạt</th></tr>
                  </thead>
                  <tbody>
                    {selected.windowMetrics.map((window) => (
                      <tr key={window.id}>
                        <td>
                          <strong>{window.label || window.id}</strong>
                          {!window.includeInScore && <small>chỉ tham khảo</small>}
                        </td>
                        <td className="mono">{money(window.value)}</td>
                        <td className="mono">{formatNumber(window.spend, project.config.currency)}</td>
                        <td className="mono">{formatCount(window.result, 0)}</td>
                        <td>
                          <span className={`bandPill band-${achievementBand(window.achievement)}`}>
                            {formatPercent(window.achievement)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {onAnalyzeAction && selectedRow?.action && (
              <button className="secondaryAction fullWidthAction" onClick={() => onAnalyzeAction(selectedRow.action!.id)}>
                <Sparkles size={16} /> Phân tích thêm bằng AI
              </button>
            )}

            <details className="ruleTrace">
              <summary>Mã rule và mã lý do</summary>
              <div>
                {selected.matchedRuleIds.map((id) => <code key={id}>{id}</code>)}
                {selected.reasonCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
            </details>
          </aside>
        </div>
      )}
    </div>
  );
}
