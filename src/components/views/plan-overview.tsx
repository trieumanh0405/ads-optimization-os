"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import type { ScopeSummary } from "@/core/pacing";
import type { ProjectConfig } from "@/core/schemas";
import { formatNumber } from "../helpers/format-utils";
import { achievementBand, formatCount, formatPercent } from "../helpers/reason-labels";

export type PlanOverviewProps = {
  summary: ScopeSummary;
  config: ProjectConfig;
  /** Weights of the second layer, shown so the score is never a black box. */
  contextWeights: { entity: number; context: number };
  contextSource: "PARENT" | "PROJECT";
  /** Account-level score, used to warn when the plan target looks unreachable. */
  accountAchievement: number | null;
  /** Configured score weight per window, shown next to each window label. */
  windowWeights: Array<{ id: string; label: string; weight: number }>;
};

const BANDS: Array<{ min: number; max: number | null; label: string; tone: string }> = [
  { min: 1.2, max: null, label: "Giữ / tăng đầu tư", tone: "scale" },
  { min: 1.0, max: 1.2, label: "Giữ", tone: "keep" },
  { min: 0.8, max: 1.0, label: "Giữ ad / giảm ngân sách", tone: "watch" },
  { min: 0, max: 0.8, label: "Tắt", tone: "off" }
];

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className={`planFigure${tone ? ` band-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function PlanOverview({
  summary,
  config,
  contextWeights,
  contextSource,
  accountAchievement,
  windowWeights
}: PlanOverviewProps) {
  const [open, setOpen] = useState(true);
  const currency = summary.currency;
  const { actual, plan, pacing, today } = summary;
  const hasEstimate = plan.rate !== null;
  const band = achievementBand(summary.achievement);

  // With the second layer switched on, the score a rule matches is not the
  // entity's own score, so the real pass mark moves. Spelling it out keeps the
  // threshold table honest.
  const effectiveOffThreshold = contextWeights.context > 0 && accountAchievement !== null && contextSource === "PROJECT"
    ? (0.8 - contextWeights.context * accountAchievement) / contextWeights.entity
    : null;

  const targetUnreachable = accountAchievement !== null && accountAchievement < 0.8;

  return (
    <section className="sectionCard planOverview">
      <div className="sectionHeader">
        <div>
          <span className="sectionKicker">KẾ HOẠCH VÀ THỰC TẾ</span>
          <h2>{summary.scopeName}</h2>
          <p>
            {summary.optimizationEventLabel} · {summary.metricKey} · {summary.entityCount.toLocaleString("vi-VN")} entity
          </p>
        </div>
        <button className="iconAction" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Thu gọn bảng tổng quan">
          <ChevronDown size={18} className={open ? "" : "rotated"} />
        </button>
      </div>

      {open && (
        <>
          <div className="planGrid">
            <dl className="planBlock">
              <span className="planBlockTitle">Thực tế</span>
              <Figure label="Đã tiêu" value={formatNumber(summary.spend, currency)} />
              <Figure label={`${summary.optimizationEventLabel} nền tảng báo`} value={formatCount(actual.reportedResults)} />
              <Figure label="Chi phí / result báo về" value={formatNumber(actual.costPerReportedResult, currency)} />
              {hasEstimate && (
                <>
                  <Figure
                    label="Result ước tính sau lọc"
                    value={formatCount(actual.qualifiedResults)}
                    hint={`${formatPercent(plan.rate)} của số báo về`}
                  />
                  <Figure label="Chi phí / result sau lọc" value={formatNumber(actual.costPerQualifiedResult, currency)} />
                </>
              )}
              <Figure
                label="So với target"
                value={formatPercent(summary.achievement)}
                tone={band}
              />
            </dl>

            <dl className="planBlock">
              <span className="planBlockTitle">Kế hoạch</span>
              <Figure label="Target chi phí / result" value={formatNumber(plan.targetCostPerQualified, currency)} />
              <Figure label="Target sản lượng cả kỳ" value={formatCount(plan.targetQualifiedResults, 0)} />
              {hasEstimate && (
                <>
                  <Figure label="% Estimate Rate" value={formatPercent(plan.rate)} />
                  <Figure
                    label="Chi phí / result báo về cần đạt"
                    value={formatNumber(plan.targetCostPerReportedResult, currency)}
                    hint="Ngưỡng thật khi mua traffic"
                  />
                  <Figure label="Result báo về cần có" value={formatCount(plan.targetReportedResults, 0)} />
                </>
              )}
              <Figure
                label="Tiến độ sản lượng"
                value={formatPercent(pacing.resultProgress)}
                hint={pacing.timeProgress === null ? "Chưa đặt ngày kết thúc" : `Thời gian đã trôi ${formatPercent(pacing.timeProgress)}`}
              />
            </dl>

            <div className="planBlock">
              <span className="planBlockTitle">Trọng số và ngưỡng</span>
              <div className="weightRow">
                <span>Cửa sổ</span>
                <div>
                  {windowWeights.map((window) => (
                    <b key={window.id} className={window.weight > 0 ? "" : "muted"}>
                      {window.label} {window.weight > 0 ? formatPercent(window.weight) : "tham khảo"}
                    </b>
                  ))}
                </div>
              </div>
              <div className="weightRow">
                <span>Phạm vi</span>
                <div>
                  <b>Entity {formatPercent(contextWeights.entity)}</b>
                  <b>{contextSource === "PROJECT" ? "Tổng tài khoản" : "Cấp cha"} {formatPercent(contextWeights.context)}</b>
                </div>
              </div>
              <table className="bandTable">
                <tbody>
                  {BANDS.map((item) => (
                    <tr key={item.label} className={band === item.tone ? "current" : ""}>
                      <td className="mono">{Math.round(item.min * 100)}%</td>
                      <td className="mono">{item.max === null ? "Max" : `${Math.round(item.max * 100)}%`}</td>
                      <td><span className={`bandPill band-${item.tone}`}>{item.label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {effectiveOffThreshold !== null && (
                <p className="planNote">
                  <Info size={14} />
                  Vì điểm gộp 40% theo tổng tài khoản ({formatPercent(accountAchievement)}), ngưỡng tắt thật của
                  từng entity đang là <b>{formatPercent(effectiveOffThreshold)}</b> chứ không phải 80%.
                </p>
              )}
            </div>
          </div>

          {targetUnreachable && (
            <div className="planWarning">
              <AlertTriangle size={18} />
              <div>
                <strong>Cả tài khoản đang ở {formatPercent(accountAchievement)} so với target</strong>
                <span>
                  Mặt bằng chung kém xa kế hoạch, nên phần lớn entity sẽ rơi vào dải tắt. Trước khi tắt hàng loạt,
                  cân nhắc xem lại target, offer hoặc tệp thay vì chỉ cắt từng ad.
                </span>
              </div>
            </div>
          )}

          <div className="windowStrip">
            {summary.windows.map((window) => (
              <article key={window.id}>
                <header>
                  <strong>{window.label}</strong>
                  <span className={`bandPill band-${achievementBand(window.achievement)}`}>
                    {formatPercent(window.achievement)}
                  </span>
                </header>
                <dl>
                  <div><dt>Chi tiêu</dt><dd className="mono">{formatNumber(window.spend, currency)}</dd></div>
                  <div><dt>Result</dt><dd className="mono">{formatCount(window.reportedResults)}</dd></div>
                  <div><dt>Chi phí / result</dt><dd className="mono">{formatNumber(window.costPerReportedResult, currency)}</dd></div>
                  {hasEstimate && (
                    <div><dt>Sau lọc</dt><dd className="mono">{formatNumber(window.costPerQualifiedResult, currency)}</dd></div>
                  )}
                </dl>
              </article>
            ))}
          </div>

          <div className="pacingStrip">
            <article>
              <small>Còn lại</small>
              <strong>{pacing.remainingDays === null ? "N/A" : `${pacing.remainingDays} ngày`}</strong>
              <em>{pacing.planEndDate ? `đến ${pacing.planEndDate}` : "chưa đặt ngày kết thúc kế hoạch"}</em>
            </article>
            <article>
              <small>Tiến độ so với lịch</small>
              <strong className={pacing.paceIndex !== null && pacing.paceIndex < 1 ? "behind" : "ahead"}>
                {formatPercent(pacing.paceIndex)}
              </strong>
              <em>{pacing.paceIndex === null ? "cần target sản lượng và ngày kết thúc" : pacing.paceIndex < 1 ? "đang chậm hơn kế hoạch" : "đang nhanh hơn kế hoạch"}</em>
            </article>
            <article>
              <small>Còn phải ra</small>
              <strong>{formatCount(pacing.qualifiedRemaining, 0)}</strong>
              <em>{pacing.requiredQualifiedPerDay === null ? "N/A" : `${formatCount(pacing.requiredQualifiedPerDay)} / ngày`}</em>
            </article>
            <article className="highlight">
              <small>
                {pacing.additionalDailySpend !== null && pacing.additionalDailySpend < 0
                  ? "Có thể giảm mỗi ngày"
                  : "Ngân sách cần đẩy thêm"}
              </small>
              <strong>
                {pacing.additionalDailySpend === null
                  ? "N/A"
                  : formatNumber(Math.abs(pacing.additionalDailySpend), currency)}
              </strong>
              <em>
                {pacing.requiredDailySpend === null
                  ? "cần target sản lượng và ngày kết thúc"
                  : pacing.additionalDailySpend !== null && pacing.additionalDailySpend < 0
                    ? `đang chạy ${formatNumber(pacing.currentDailySpend, currency)}, chỉ cần ${formatNumber(pacing.requiredDailySpend, currency)}`
                    : `mỗi ngày · đang chạy ${formatNumber(pacing.currentDailySpend, currency)}`}
              </em>
            </article>
            <article>
              <small>Tổng ngân sách còn cần</small>
              <strong>{formatNumber(pacing.remainingBudget, currency)}</strong>
              <em>
                {pacing.requiredDailySpendAtPlanEfficiency === null
                  ? "N/A"
                  : `nếu đạt đúng target: ${formatNumber(pacing.requiredDailySpendAtPlanEfficiency, currency)} / ngày`}
              </em>
            </article>
            <article>
              <small>Dự phóng cuối ngày</small>
              <strong>{formatCount(today.projectedResults)}</strong>
              <em>
                {today.basis === "EXTRAPOLATED"
                  ? `đã có ${formatCount(today.resultsSoFar)} lúc ${formatPercent(today.dayElapsed)} ngày`
                  : today.basis === "TRAILING_AVERAGE"
                    ? "còn sớm, đang lấy trung bình các ngày trước"
                    : "chưa đủ dữ liệu"}
              </em>
            </article>
          </div>

          <p className="planFootnote">
            Kỳ kế hoạch {pacing.planStartDate}
            {pacing.planEndDate ? ` đến ${pacing.planEndDate}` : " (chưa đặt ngày kết thúc)"} ·
            đã qua {pacing.elapsedDays} ngày
            {pacing.totalDays ? ` / ${pacing.totalDays}` : ""} ·
            múi giờ {config.timezone}
          </p>
        </>
      )}
    </section>
  );
}
