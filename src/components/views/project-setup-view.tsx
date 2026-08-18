"use client";

import { useState } from "react";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { standardMetricLibrary } from "@/core/library";
import { metricDefinitionSchema, type MetricDefinition, type ProjectConfig } from "@/core/schemas";
import type { LocalProject } from "@/product/types";
import { ScopeManager } from "../scope-manager";

export type ProjectSetupViewProps = {
  project: LocalProject;
  onProjectChange: (project: LocalProject) => void;
  toast: (message: string, tone?: "info" | "success" | "error") => void;
  onUpdate?: (project: LocalProject, options?: { syncConfig?: boolean }) => void;
  onDelete?: () => void;
  canDelete?: boolean;
  notify?: (message: string, tone?: "success" | "error") => void;
};

export function ProjectSetupView({
  project,
  onProjectChange,
  toast,
  onUpdate,
  onDelete,
  canDelete = true,
  notify
}: ProjectSetupViewProps) {
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

  const handleNotify = (message: string, tone: "info" | "success" | "error" = "success") => {
    if (notify) {
      notify(message, tone === "info" ? "success" : tone);
    } else if (toast) {
      toast(message, tone);
    }
  };

  const handleUpdate = (updatedProject: LocalProject, options?: { syncConfig?: boolean }) => {
    if (onUpdate) {
      onUpdate(updatedProject, options);
    } else {
      onProjectChange(updatedProject);
    }
  };

  const operandOptions = [
    "spend", "result", "qualifiedResult", "revenue", "impressions", "clicks",
    ...project.metricMappings.map((item) => `metrics.${item.metricKey}`)
  ].filter((value, index, values) => values.indexOf(value) === index);

  function patchConfig(patch: Partial<ProjectConfig>) {
    const metricChanged = patch.primaryMetricKey && patch.primaryMetricKey !== project.config.primaryMetricKey;
    handleUpdate({
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
    if (sum <= 0) return handleNotify("Tổng weight phải lớn hơn 0.", "error");
    patchConfig({
      windows: project.config.windows.map((item) => ({ ...item, weight: Number((item.weight / sum).toFixed(4)) }))
    });
    handleNotify("Đã normalize window weights về 100%.");
  }

  function addMetricDefinition() {
    const parsed = metricDefinitionSchema.safeParse({
      ...metricDraft,
      key: metricDraft.key.trim().toUpperCase().replace(/\s+/g, "_"),
      denominator: metricDraft.kind === "SUM" ? null : metricDraft.denominator
    });
    if (!parsed.success) {
      return handleNotify(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · "), "error");
    }
    if (project.metricDefinitions.some((item) => item.key === parsed.data.key)) {
      return handleNotify(`Metric key ${parsed.data.key} đã tồn tại.`, "error");
    }
    handleUpdate({
      ...project,
      metricDefinitions: [...project.metricDefinitions, parsed.data],
      updatedAt: new Date().toISOString()
    });
    setMetricDraft((current) => ({ ...current, key: "CUSTOM_KPI", label: "Custom KPI" }));
    handleNotify(`Đã thêm metric ${parsed.data.key}.`);
  }

  function removeMetricDefinition(metric: MetricDefinition) {
    if (standardMetricLibrary.some((item) => item.key === metric.key)) return;
    if (project.config.primaryMetricKey === metric.key) {
      return handleNotify("Hãy đổi Primary KPI trước khi xóa metric này.", "error");
    }
    handleUpdate({
      ...project,
      metricDefinitions: project.metricDefinitions.filter((item) => item.key !== metric.key),
      updatedAt: new Date().toISOString()
    });
    handleNotify(`Đã xóa metric ${metric.key}.`);
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
          <label>Ngày kết thúc kế hoạch
            <input
              type="date"
              value={project.config.planEndDate ?? ""}
              min={project.config.startDate}
              onChange={(event) => patchConfig({ planEndDate: event.target.value || null })}
            />
            <small className="fieldHint">Cần có để tính tiến độ và ngân sách còn phải đẩy.</small>
          </label>
        </div>
      </section>

      <ScopeManager project={project} onUpdate={handleUpdate} notify={handleNotify} />

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
          <div>
            <span className="sectionKicker">GUARDRAILS</span>
            <h2>Trọng số Entity / Context và giới hạn scale</h2>
            <p>
              Điểm dùng để quyết định = điểm riêng entity nhân Entity %, cộng điểm nhóm nhân Context %.
              Để Context 0% nếu chỉ muốn chấm theo bản thân entity. Chọn nhóm nào là ở ô
              “Điểm nhóm lấy từ” trong phần scope. Campaign CBO và Ad set ABO mới được tăng giảm budget.
            </p>
          </div>
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
          {canDelete && onDelete && <button className="dangerAction" onClick={() => void onDelete()}><Trash2 size={15} /> Xóa project</button>}
          <span className="helperText"><Save size={14} /> Mọi thay đổi được auto-save vào IndexedDB.</span>
        </div>
      </section>
    </div>
  );
}
