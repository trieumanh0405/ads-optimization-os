"use client";

import { useState } from "react";
import { CheckCircle2, ClipboardCheck, X } from "lucide-react";
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
};

export function ActionQueue({
  project,
  operatorName = "",
  onProjectChange,
  toast,
  teamApi
}: ActionQueueProps) {
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
        {(["PENDING", "DONE", "DEFERRED", "REJECTED"] as const).map((item, index) => (
          <article key={item}>
            <span className={`metricIcon ${["amber", "green", "blue", "red"][index]}`}>
              <ClipboardCheck size={18} />
            </span>
            <div>
              <small>{item}</small>
              <strong>{project.actions.filter((action) => action.approvalStatus === item).length}</strong>
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
          <div className="segmented">
            {(["PENDING", "DEFERRED", "DONE", "REJECTED", "ALL"] as const).map((item) => (
              <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>
                {item}
              </button>
            ))}
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
                {actions.map((action) => (
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
                      <button
                        className="secondaryAction small"
                        onClick={() => open(action)}
                        disabled={action.approvalStatus === "DONE" || action.approvalStatus === "REJECTED"}
                      >
                        Review
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
