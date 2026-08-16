"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Search, Sparkles, X } from "lucide-react";
import type { ActionEvent, ActionRecord, ApprovalStatus } from "@/core/actions";
import type { TeamApi } from "@/product/team-api";
import type { LocalProject } from "@/product/types";
import { actionLabel, formatNumber } from "../helpers/format-utils";

export type ActionQueueProps = {
  project: LocalProject;
  onProjectChange: (project: LocalProject) => void;
  teamApi: TeamApi | null;
  toast: (message: string, tone?: "info" | "success" | "error") => void;
  operatorName?: string;
  onAnalyzeAction?: (actionId: string) => void;
};

const PAGE_SIZE = 50;
const isReviewAction = (action: ActionRecord) => action.recommendedAction === "REVIEW_MANUALLY";
const entityQueueKey = (action: ActionRecord) => `${action.scopeId}|${action.entityLevel}|${action.entityId}`;

export function ActionQueue({
  project,
  operatorName = "",
  onProjectChange,
  toast,
  teamApi,
  onAnalyzeAction
}: ActionQueueProps) {
  const [queueView, setQueueView] = useState<"OPERATE" | "REVIEW" | "HISTORY">("OPERATE");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const selected = project.actions.find((item) => item.id === selectedId) ?? null;
  const openActions = useMemo(() => {
    const latest = new Map<string, ActionRecord>();
    [...project.actions]
      .filter((action) => action.approvalStatus === "PENDING" || action.approvalStatus === "DEFERRED")
      .sort((a, b) => b.runAt.localeCompare(a.runAt))
      .forEach((action) => {
        const key = entityQueueKey(action);
        if (!latest.has(key)) latest.set(key, action);
      });
    return [...latest.values()];
  }, [project.actions]);
  const actions = useMemo(() => {
    const source = queueView === "HISTORY"
      ? project.actions.filter((action) => action.approvalStatus === "DONE" || action.approvalStatus === "REJECTED")
      : openActions.filter((action) => queueView === "REVIEW" ? isReviewAction(action) : !isReviewAction(action));
    const query = search.trim().toLowerCase();
    return source.filter((action) => !query || `${action.entityName} ${action.entityId} ${action.recommendedAction}`.toLowerCase().includes(query));
  }, [openActions, project.actions, queueView, search]);
  const pageCount = Math.max(1, Math.ceil(actions.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedActions = actions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const operateCount = openActions.filter((action) => !isReviewAction(action)).length;
  const reviewCount = openActions.filter(isReviewAction).length;

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
    if (!valid[selected.approvalStatus].includes(to))
      return toast(`Transition ${selected.approvalStatus} → ${to} không hợp lệ.`, "error");
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
        await teamApi(
          `/api/projects/${encodeURIComponent(project.config.projectId)}/actions/${encodeURIComponent(selected.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to, at, note: note || null })
          }
        );
      } catch (error) {
        return toast(error instanceof Error ? error.message : "ACTION_UPDATE_FAILED", "error");
      }
    }
    onProjectChange({
      ...project,
      actions: project.actions.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              approvalStatus: to,
              reviewer: actor,
              executedAt: to === "DONE" ? at : item.executedAt,
              note: note || null
            }
          : item
      ),
      actionLog: [event, ...project.actionLog],
      updatedAt: at
    });
    setSelectedId(null);
    toast(`Action đã chuyển sang ${to}.`, "success");
  }

  return (
    <div className="viewStack">
      <section className="metricStrip">
        {[
          { label: "Cần thực hiện", value: operateCount, tone: "amber" },
          { label: "Cần review", value: reviewCount, tone: "blue" },
          { label: "Đã hoàn tất", value: project.actions.filter((action) => action.approvalStatus === "DONE").length, tone: "green" },
          { label: "Đã từ chối", value: project.actions.filter((action) => action.approvalStatus === "REJECTED").length, tone: "red" }
        ].map((item) => (
          <article key={item.label}>
            <span className={`metricIcon ${item.tone}`}>
              <ClipboardCheck size={18} />
            </span>
            <div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <em>actions</em>
            </div>
          </article>
        ))}
      </section>
      <section className="sectionCard">
        <div className="sectionHeader filtersHeader">
          <div>
            <span className="sectionKicker">MANUAL EXECUTION WORKFLOW</span>
            <h2>Action queue</h2>
            <p>V1 không gọi Meta API; media buyer xác nhận sau khi thao tác trong Ads Manager.</p>
          </div>
          <div className="queueControls">
            <label className="compactSearch">
              <Search size={15} />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm entity…" />
            </label>
            <div className="segmented">
            {(["OPERATE", "REVIEW", "HISTORY"] as const).map((item) => (
              <button key={item} className={queueView === item ? "active" : ""} onClick={() => { setQueueView(item); setPage(1); }}>
                {item === "OPERATE" ? "Thực hiện" : item === "REVIEW" ? "Cần review" : "Lịch sử"}
              </button>
            ))}
            </div>
          </div>
        </div>
        {!actions.length ? (
          <div className="emptyState">
            <ClipboardCheck size={28} />
            <strong>Không có action ở trạng thái này</strong>
            <span>Chạy engine hoặc đổi bộ lọc.</span>
          </div>
        ) : (
          <div className="tableScroller">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Evidence</th>
                  <th>Confidence</th>
                  <th>Run time</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pagedActions.map((action) => (
                  <tr key={action.id}>
                    <td>
                      <span className={`levelPill ${action.entityLevel.toLowerCase()}`}>{action.entityLevel}</span>
                      <strong>{action.entityName}</strong>
                      <small className="mono">{action.entityId}</small>
                    </td>
                    <td>
                      <span className={`actionPill action-${action.recommendedAction.toLowerCase()}`}>
                        {actionLabel(action.recommendedAction)}
                      </span>
                      <small>{action.adjustmentPct === null ? "" : `${Math.round(action.adjustmentPct * 100)}%`}</small>
                    </td>
                    <td>
                      <strong>
                        {formatNumber(action.currentMetric)} / {formatNumber(action.targetMetric)}
                      </strong>
                      <small>{action.reasonCodes.join(" · ")}</small>
                    </td>
                    <td className="mono">{Math.round(action.confidence * 100)}%</td>
                    <td>{new Date(action.runAt).toLocaleString("vi-VN")}</td>
                    <td>
                      <span className={`statusBadge status-${action.approvalStatus.toLowerCase()}`}>
                        {action.approvalStatus}
                      </span>
                    </td>
                    <td>
                      <div className="rowActions">
                        {onAnalyzeAction && (
                          <button className="iconAction" onClick={() => onAnalyzeAction(action.id)} aria-label={`Phân tích AI ${action.entityName}`}>
                            <Sparkles size={16} />
                          </button>
                        )}
                        <button
                          className="secondaryAction small"
                          onClick={() => open(action)}
                          disabled={action.approvalStatus === "DONE" || action.approvalStatus === "REJECTED"}
                        >
                          Xử lý
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {actions.length > PAGE_SIZE && (
          <div className="paginationBar">
            <span>{actions.length.toLocaleString("vi-VN")} action · Trang {safePage}/{pageCount}</span>
            <div>
              <button className="iconAction" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Trang trước"><ChevronLeft size={17} /></button>
              <button className="iconAction" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="Trang sau"><ChevronRight size={17} /></button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setSelectedId(null)}>
          <section
            className="productModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalTitle">
              <div>
                <span className="sectionKicker">{selected.entityLevel}</span>
                <h2 id="action-review-title">{selected.entityName}</h2>
                <p>
                  {actionLabel(selected.recommendedAction)}{" "}
                  {selected.adjustmentPct === null ? "" : `${Math.round(selected.adjustmentPct * 100)}%`}
                </p>
              </div>
              <button className="iconAction" onClick={() => setSelectedId(null)} aria-label="Đóng">
                <X size={18} />
              </button>
            </div>
            <div className="actionEvidence">
              <div>
                <small>KPI / target</small>
                <strong>
                  {formatNumber(selected.currentMetric)} / {formatNumber(selected.targetMetric)}
                </strong>
              </div>
              <div>
                <small>Confidence</small>
                <strong>{Math.round(selected.confidence * 100)}%</strong>
              </div>
              <div>
                <small>Rule</small>
                <strong>{selected.matchedRuleIds.join(", ")}</strong>
              </div>
            </div>
            <label className="modalTextarea">
              Note
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Đã kiểm tra Ads Manager / lý do reject / thời điểm defer…"
              />
            </label>
            {onAnalyzeAction && (
              <button className="secondaryAction fullWidthAction" onClick={() => onAnalyzeAction(selected.id)}>
                <Sparkles size={16} /> Phân tích thêm bằng AI
              </button>
            )}
            <div className="modalActions spread">
              <button className="dangerAction" onClick={() => transition("REJECTED")}>
                Reject
              </button>
              <button
                className="secondaryAction"
                onClick={() => transition(selected.approvalStatus === "DEFERRED" ? "PENDING" : "DEFERRED")}
              >
                {selected.approvalStatus === "DEFERRED" ? "Đưa lại Pending" : "Defer"}
              </button>
              <button className="primaryAction" onClick={() => transition("DONE")}>
                <CheckCircle2 size={16} /> Mark done
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
