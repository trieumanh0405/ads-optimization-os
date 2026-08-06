"use client";

import { Database, FileSpreadsheet, History, Play, ShieldAlert } from "lucide-react";
import type { LocalProject } from "@/product/types";

export type RunsAuditProps = {
  project: LocalProject;
};

export function RunsAudit({ project }: RunsAuditProps) {
  return (
    <div className="auditGrid">
      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">ENGINE RUNS</span>
            <h2>{project.runs.length} runs</h2>
            <p>Snapshot rule version và QC của từng lần chạy.</p>
          </div>
        </div>
        <div className="timelineList">
          {project.runs.length ? (
            project.runs.map((run) => (
              <article key={run.runId}>
                <span className={`timelineIcon ${run.status === "BLOCKED" ? "danger" : "success"}`}>
                  {run.status === "BLOCKED" ? <ShieldAlert size={16} /> : <Play size={16} />}
                </span>
                <div>
                  <strong>
                    {run.status} · QC {run.qc.status}
                  </strong>
                  <small>
                    {new Date(run.runAt).toLocaleString("vi-VN")} · {run.recommendations.length} decisions ·{" "}
                    {run.actions.length} actions
                  </small>
                  <code>{run.runId}</code>
                </div>
              </article>
            ))
          ) : (
            <div className="emptyState compact">
              <History size={24} />
              <span>Chưa có run.</span>
            </div>
          )}
        </div>
      </section>
      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">IMPORT HISTORY</span>
            <h2>{project.imports.length} imports</h2>
            <p>Accepted/rejected được lưu theo batch.</p>
          </div>
        </div>
        <div className="timelineList">
          {project.imports.length ? (
            project.imports.map((item) => (
              <article key={item.id}>
                <span className={`timelineIcon ${item.rejected ? "warning" : "success"}`}>
                  <FileSpreadsheet size={16} />
                </span>
                <div>
                  <strong>{item.fileName}</strong>
                  <small>
                    {item.entityLevel} · {item.accepted} accepted · {item.rejected} rejected · {item.mode}
                  </small>
                  <code>{new Date(item.importedAt).toLocaleString("vi-VN")}</code>
                </div>
              </article>
            ))
          ) : (
            <div className="emptyState compact">
              <Database size={24} />
              <span>Chưa import data.</span>
            </div>
          )}
        </div>
      </section>
      <section className="sectionCard fullSpan">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">APPEND-ONLY ACTION LOG</span>
            <h2>{project.actionLog.length} events</h2>
            <p>Action DONE/REJECTED không được sửa ngược.</p>
          </div>
        </div>
        <div className="tableScroller">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action ID</th>
                <th>Actor</th>
                <th>Transition</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {project.actionLog.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.at).toLocaleString("vi-VN")}</td>
                  <td className="mono">{event.actionId}</td>
                  <td>{event.actor}</td>
                  <td>
                    <strong>
                      {event.from} → {event.to}
                    </strong>
                  </td>
                  <td>{event.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
