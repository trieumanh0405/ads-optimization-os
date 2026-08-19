"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { ScopeSummary } from "@/core/pacing";
import type { ProjectConfig } from "@/core/schemas";
import { formatNumber } from "../helpers/format-utils";
import { achievementBand, formatCount, formatPercent } from "../helpers/reason-labels";
import { NotchMeter } from "../helpers/meters";

export type PlanOverviewProps = {
  summary: ScopeSummary;
  config: ProjectConfig;
  contextWeights: { entity: number; context: number };
  contextSource: "PARENT" | "PROJECT";
  windowWeights: Array<{ id: string; label: string; weight: number }>;
};

const BANDS = [
  { min: 1.2, max: null, label: "Giữ / tăng đầu tư", tone: "scale" },
  { min: 1.0, max: 1.2, label: "Giữ", tone: "keep" },
  { min: 0.8, max: 1.0, label: "Giữ ad / giảm ngân sách", tone: "watch" },
  { min: 0, max: 0.8, label: "Tắt", tone: "off" }
] as const;

/** One figure in the masthead: a number large enough to read across a desk. */
function Figure({
  label, value, sub, tone, meter
}: { label: string; value: string; sub?: string; tone?: string; meter?: number | null }) {
  return (
    <div className={`figure${tone ? ` band-${tone}` : ""}`}>
      <span className="figureLabel">{label}</span>
      <strong className="figureValue">{value}</strong>
      {meter !== undefined && <NotchMeter value={meter} size="lead" />}
      {sub && <span className="figureSub">{sub}</span>}
    </div>
  );
}

export function PlanOverview({
  summary,
  config,
  contextWeights,
  contextSource,
  windowWeights
}: PlanOverviewProps) {
  const [open, setOpen] = useState(false);
  const currency = summary.currency;
  const { actual, plan, pacing, today } = summary;
  const hasEstimate = plan.rate !== null;
  const band = achievementBand(summary.achievement);

  const money = (value: number | null | undefined) => formatNumber(value ?? null, currency);

  // With the second layer on, the score a rule matches is not the entity's own,
  // so the real pass mark moves. Left unsaid, the threshold table lies.
  const effectiveOffThreshold = contextWeights.context > 0 && contextSource === "PROJECT" && summary.achievement !== null
    ? (0.8 - contextWeights.context * summary.achievement) / contextWeights.entity
    : null;
  const thresholdDistorted = effectiveOffThreshold !== null && Math.abs(effectiveOffThreshold - 0.8) > 0.05;
  const targetUnreachable = summary.achievement !== null && summary.achievement < 0.8;

  const budgetGap = pacing.additionalDailySpend;
  const planConfigured = pacing.planEndDate !== null && plan.targetQualifiedResults !== null;

  return (
    <section className="scopeMasthead">
      <div className="mastheadHead">
        <div className="mastheadIdentity">
          <span className="mastheadKicker">Nhóm KPI</span>
          <h2>{summary.scopeName}</h2>
          <small>
            {summary.metricKey} · {summary.entityCount.toLocaleString("vi-VN")} entity ·
            {" "}mục tiêu {money(plan.targetCostPerReportedResult)} / {summary.optimizationEventLabel}
          </small>
        </div>
        <button className="mastheadToggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Thu gọn" : "Chi tiết"}
          <ChevronDown size={15} className={open ? "flipped" : ""} />
        </button>
      </div>

      <div className="mastheadFigures">
        <Figure label="Đã tiêu" value={money(summary.spend)} sub={`${config.startDate} → nay`} />
        <Figure
          label={`Chi phí / ${summary.optimizationEventLabel}`}
          value={money(actual.costPerReportedResult)}
          sub={`${formatCount(actual.reportedResults, 0)} ${summary.optimizationEventLabel} nền tảng báo`}
        />
        <Figure
          label="So với target"
          value={formatPercent(summary.achievement)}
          tone={band}
          meter={summary.achievement}
          sub="vạch đứng là mốc 100%"
        />
        {planConfigured && (
          <Figure
            label="Tiến độ sản lượng"
            value={formatPercent(pacing.resultProgress)}
            tone={pacing.paceIndex !== null && pacing.paceIndex < 1 ? "off" : "keep"}
            sub={pacing.timeProgress === null
              ? undefined
              : `thời gian đã trôi ${formatPercent(pacing.timeProgress)} · còn ${pacing.remainingDays} ngày`}
          />
        )}
        {planConfigured && budgetGap !== null && (
          <Figure
            label={budgetGap < 0 ? "Có thể giảm mỗi ngày" : "Cần đẩy thêm mỗi ngày"}
            value={money(Math.abs(budgetGap))}
            sub={`đang chạy ${money(pacing.currentDailySpend)} / ngày`}
          />
        )}
      </div>

      {(targetUnreachable || thresholdDistorted) && (
        <div className="planAlerts">
          {targetUnreachable && (
            <p className="alertSevere">
              <AlertTriangle size={15} />
              <span>
                Nhóm <b>{summary.scopeName}</b> đang ở <b>{formatPercent(summary.achievement)}</b> so với target,
                nên phần lớn entity sẽ rơi vào dải tắt. Xem lại target hoặc offer trước khi tắt hàng loạt.
              </span>
            </p>
          )}
          {thresholdDistorted && (
            <p className="alertWarn">
              <AlertTriangle size={15} />
              <span>
                Điểm gộp {formatPercent(contextWeights.context)} theo tổng tài khoản đang kéo ngưỡng tắt thật
                của từng entity lên <b>{formatPercent(effectiveOffThreshold)}</b> thay vì 80%.
                Đổi “Điểm nhóm lấy từ” sang cấp cha nếu không cố ý.
              </span>
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="planDetail">
          <div className="planDetailGrid">
            <div className="detailBlock">
              <span className="detailTitle">Thực tế</span>
              <dl>
                <div><dt>Đã tiêu</dt><dd>{money(summary.spend)}</dd></div>
                <div><dt>{summary.optimizationEventLabel} nền tảng báo</dt><dd>{formatCount(actual.reportedResults, 0)}</dd></div>
                <div><dt>Chi phí / result</dt><dd>{money(actual.costPerReportedResult)}</dd></div>
                {hasEstimate && (
                  <>
                    <div><dt>Result sau lọc {formatPercent(plan.rate)}</dt><dd>{formatCount(actual.qualifiedResults)}</dd></div>
                    <div><dt>Chi phí / result sau lọc</dt><dd>{money(actual.costPerQualifiedResult)}</dd></div>
                  </>
                )}
              </dl>
            </div>

            <div className="detailBlock">
              <span className="detailTitle">Kế hoạch</span>
              <dl>
                <div><dt>Target chi phí / result</dt><dd>{money(plan.targetCostPerQualified)}</dd></div>
                {hasEstimate && (
                  <div className="highlightRow">
                    <dt>Ngưỡng thật khi mua traffic</dt>
                    <dd>{money(plan.targetCostPerReportedResult)}</dd>
                  </div>
                )}
                <div><dt>Target sản lượng cả kỳ</dt><dd>{formatCount(plan.targetQualifiedResults, 0)}</dd></div>
                <div>
                  <dt>Kỳ kế hoạch</dt>
                  <dd>{pacing.planStartDate} {pacing.planEndDate ? `→ ${pacing.planEndDate}` : "→ chưa đặt"}</dd>
                </div>
              </dl>
            </div>

            <div className="detailBlock">
              <span className="detailTitle">Trọng số và ngưỡng</span>
              <div className="weightLine">
                <span>Cửa sổ</span>
                <div>
                  {windowWeights.map((window) => (
                    <b key={window.id} className={window.weight > 0 ? "" : "muted"}>
                      {window.label} {window.weight > 0 ? formatPercent(window.weight) : "tham khảo"}
                    </b>
                  ))}
                </div>
              </div>
              <div className="weightLine">
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
                      <td className="mono">
                        {Math.round(item.min * 100)}%
                        {item.max === null ? " trở lên" : ` - ${Math.round(item.max * 100)}%`}
                      </td>
                      <td><span className={`bandPill band-${item.tone}`}>{item.label}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <table className="windowTable">
            <thead>
              <tr>
                <th>Cửa sổ</th>
                <th>Chi tiêu</th>
                <th>Result</th>
                <th>Chi phí / result</th>
                {hasEstimate && <th>Sau lọc</th>}
                <th>Đạt target</th>
              </tr>
            </thead>
            <tbody>
              {summary.windows.map((window) => (
                <tr key={window.id}>
                  <td><strong>{window.label}</strong></td>
                  <td className="mono">{money(window.spend)}</td>
                  <td className="mono">{formatCount(window.reportedResults, 0)}</td>
                  <td className="mono">{money(window.costPerReportedResult)}</td>
                  {hasEstimate && <td className="mono">{money(window.costPerQualifiedResult)}</td>}
                  <td>
                    <span className={`bandPill band-${achievementBand(window.achievement)}`}>
                      {formatPercent(window.achievement)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {planConfigured ? (
            <div className="pacingLine">
              <span><b>{pacing.remainingDays}</b> ngày còn lại</span>
              <span><b>{formatCount(pacing.qualifiedRemaining, 0)}</b> result còn phải ra</span>
              <span><b>{formatCount(pacing.requiredQualifiedPerDay)}</b> / ngày</span>
              <span>Tổng ngân sách còn cần <b>{money(pacing.remainingBudget)}</b></span>
              {pacing.requiredDailySpendAtPlanEfficiency !== null && (
                <span>Nếu đạt đúng target chỉ cần <b>{money(pacing.requiredDailySpendAtPlanEfficiency)}</b> / ngày</span>
              )}
              <span>
                Dự phóng cuối ngày <b>{formatCount(today.projectedResults)}</b>
                {today.basis === "EXTRAPOLATED" ? ` (đã có ${formatCount(today.resultsSoFar, 0)})` : " (theo trung bình các ngày trước)"}
              </span>
            </div>
          ) : (
            <p className="planHint">
              Điền <b>Ngày kết thúc kế hoạch</b> và <b>Số result mục tiêu cả kỳ</b> trong Project &amp; KPI
              để tool tính tiến độ và ngân sách còn phải đẩy.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
