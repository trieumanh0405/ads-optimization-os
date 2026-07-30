"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import type {
  ClassificationRule,
  OptimizationScope,
  WindowConfig
} from "@/core/schemas";
import { legacyScope, resolvedScopes } from "@/core/scopes";
import { buildDefaultRules, slugify } from "@/product/defaults";
import type { LocalProject } from "@/product/types";

type Props = {
  project: LocalProject;
  onUpdate: (project: LocalProject) => void;
  notify: (message: string, tone?: "success" | "error") => void;
};

function windowId(days: number) {
  return `D${days}-${crypto.randomUUID().slice(0, 4)}`;
}

export function ScopeManager({ project, onUpdate, notify }: Props) {
  const initialScopes = project.config.optimizationScopes.length
    ? project.config.optimizationScopes
    : [legacyScope(project.config)];
  const [selectedScopeId, setSelectedScopeId] = useState(initialScopes[0]?.scopeId ?? "");
  const scopes = resolvedScopes({
    ...project.config,
    optimizationScopes: project.config.optimizationScopes.length ? project.config.optimizationScopes : initialScopes
  });
  const selected = scopes.find((scope) => scope.scopeId === selectedScopeId) ?? scopes[0];

  function saveScopes(nextScopes: OptimizationScope[], nextRules = project.rules, nextClassification = project.config.classificationRules) {
    const primary = nextScopes[0];
    if (!primary) return notify("Project phải có ít nhất một optimization scope.", "error");
    onUpdate({
      ...project,
      config: {
        ...project.config,
        primaryMetricKey: primary.primaryMetricKey,
        optimizationEventLabel: primary.optimizationEventLabel,
        target: primary.planTarget,
        ruleSetId: primary.ruleSetId,
        ruleVersion: primary.ruleVersion,
        windows: primary.windows,
        optimizationScopes: nextScopes,
        classificationRules: nextClassification
      },
      rules: nextRules,
      updatedAt: new Date().toISOString()
    });
  }

  function patchScope(patch: Partial<OptimizationScope>) {
    if (!selected) return;
    saveScopes(scopes.map((scope) => scope.scopeId === selected.scopeId ? { ...scope, ...patch } : scope));
  }

  function addScope() {
    const base = selected ?? legacyScope(project.config);
    const name = `PFM Scope ${scopes.length + 1}`;
    const scopeId = `${slugify(name)}-${crypto.randomUUID().slice(0, 5)}`;
    const ruleSetId = `${project.config.projectId}-${scopeId}-rules`;
    const scope: OptimizationScope = {
      ...structuredClone(base),
      scopeId,
      name,
      ruleSetId,
      fallbackClassification: "REVIEW_UNCLASSIFIED"
    };
    saveScopes([...scopes, scope], [...project.rules, ...buildDefaultRules(scope.primaryMetricKey, ruleSetId, scope.windows)]);
    setSelectedScopeId(scopeId);
    notify("Đã thêm optimization scope.");
  }

  function removeScope() {
    if (!selected || scopes.length <= 1) return notify("Project phải giữ ít nhất một scope.", "error");
    if (!window.confirm(`Xóa scope "${selected.name}"? Action history cũ vẫn được giữ.`)) return;
    const next = scopes.filter((scope) => scope.scopeId !== selected.scopeId);
    const nextRules = project.rules.filter((rule) => rule.ruleSetId !== selected.ruleSetId);
    const nextClassification = project.config.classificationRules.filter((rule) => rule.scopeId !== selected.scopeId);
    saveScopes(next, nextRules, nextClassification);
    setSelectedScopeId(next[0].scopeId);
  }

  function addWindow() {
    if (!selected) return;
    const usedDays = new Set(
      selected.windows
        .filter((window) => (window.kind ?? "ROLLING") === "ROLLING" && window.days)
        .map((window) => window.days as number)
    );
    const suggestedDays = [14, 30, 60, 90].find((days) => !usedDays.has(days));
    const days = suggestedDays ?? Math.max(0, ...usedDays) + 7;
    patchScope({
      windows: [...selected.windows, {
        id: windowId(days),
        label: `${days} Days`,
        kind: "ROLLING",
        days,
        weight: 0,
        required: false,
        includeInScore: false,
        role: "DIAGNOSTIC",
        minSpend: 0,
        minResults: 0,
        redFlagThreshold: null
      }]
    });
  }

  function patchWindow(index: number, patch: Partial<WindowConfig>) {
    if (!selected) return;
    patchScope({ windows: selected.windows.map((window, itemIndex) => itemIndex === index ? { ...window, ...patch } : window) });
  }

  function removeWindow(index: number) {
    if (!selected || selected.windows.length <= 1) return notify("Scope phải có ít nhất một window.", "error");
    patchScope({ windows: selected.windows.filter((_, itemIndex) => itemIndex !== index) });
  }

  function normalizeWeights() {
    if (!selected) return;
    const total = selected.windows
      .filter((window) => window.includeInScore)
      .reduce((sum, window) => sum + window.weight, 0);
    if (total <= 0) return notify("Cần ít nhất một window tham gia score.", "error");
    patchScope({
      windows: selected.windows.map((window) => window.includeInScore
        ? { ...window, weight: Number((window.weight / total).toFixed(4)) }
        : { ...window, weight: 0 })
    });
    notify("Đã normalize các window tham gia geometric score về 100%.");
  }

  const rulesForScope = useMemo(
    () => project.config.classificationRules.filter((rule) => !rule.scopeId || rule.scopeId === selected?.scopeId),
    [project.config.classificationRules, selected?.scopeId]
  );

  function addClassificationRule(outcome: ClassificationRule["outcome"]) {
    if (!selected) return;
    const rule: ClassificationRule = {
      id: `class-${crypto.randomUUID().slice(0, 8)}`,
      name: outcome === "PFM_INCLUDED" ? `Đưa vào ${selected.name}` : "Loại Non-PFM",
      field: "entityName",
      operator: "CONTAINS",
      values: outcome === "PFM_INCLUDED" ? ["Purchase", "Sale", "Mess", "Lead"] : ["Reach", "Awareness", "Enga", "Thru", "Follow"],
      outcome,
      scopeId: outcome === "PFM_INCLUDED" ? selected.scopeId : null,
      priority: outcome === "NON_PFM_EXCLUDED" ? 50 : 100,
      enabled: true
    };
    saveScopes(scopes, project.rules, [...project.config.classificationRules, rule]);
  }

  function patchClassification(ruleId: string, patch: Partial<ClassificationRule>) {
    saveScopes(scopes, project.rules, project.config.classificationRules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule));
  }

  function removeClassification(ruleId: string) {
    saveScopes(scopes, project.rules, project.config.classificationRules.filter((rule) => rule.id !== ruleId));
  }

  if (!selected) return null;
  const scoreWeight = selected.windows.filter((window) => window.includeInScore).reduce((sum, window) => sum + window.weight, 0);

  return (
    <>
      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">OPTIMIZATION SCOPES</span>
            <h2>Nhóm PFM và KPI riêng</h2>
            <p>Mỗi scope có KPI, Plan Target, geometric windows, cohort benchmark và rule set riêng.</p>
          </div>
          <button className="secondaryAction" onClick={addScope}><Plus size={15} /> Thêm scope</button>
        </div>
        <div className="scopeTabs">
          {scopes.map((scope) => (
            <button key={scope.scopeId} className={scope.scopeId === selected.scopeId ? "active" : ""} onClick={() => setSelectedScopeId(scope.scopeId)}>
              <strong>{scope.name}</strong><small>{scope.primaryMetricKey}</small>
            </button>
          ))}
        </div>
        <div className="formGrid">
          <label>Tên scope<input value={selected.name} onChange={(event) => patchScope({ name: event.target.value })} /></label>
          <label>Primary KPI
            <select value={selected.primaryMetricKey} onChange={(event) => patchScope({ primaryMetricKey: event.target.value })}>
              {project.metricDefinitions.map((metric) => <option key={metric.key} value={metric.key}>{metric.key} · {metric.label}</option>)}
            </select>
          </label>
          <label>Plan Target<input type="number" min="0.0001" value={selected.planTarget} onChange={(event) => patchScope({ planTarget: Number(event.target.value) })} /></label>
          <label>Result nghĩa là<input value={selected.optimizationEventLabel} onChange={(event) => patchScope({ optimizationEventLabel: event.target.value })} /></label>
          <label>Achievement cap %
            <input type="number" min="100" value={selected.achievementCap * 100} onChange={(event) => patchScope({ achievementCap: Number(event.target.value) / 100 })} />
          </label>
          <label>Sàn window để scale %
            <input type="number" min="0" value={selected.scaleMinWindowAchievement * 100} onChange={(event) => patchScope({ scaleMinWindowAchievement: Number(event.target.value) / 100 })} />
          </label>
          <label>Sàn context để scale %
            <input type="number" min="0" value={selected.contextScaleMinAchievement * 100} onChange={(event) => patchScope({ contextScaleMinAchievement: Number(event.target.value) / 100 })} />
          </label>
          <label>Unmatched naming
            <select value={selected.fallbackClassification} onChange={(event) => patchScope({ fallbackClassification: event.target.value as OptimizationScope["fallbackClassification"] })}>
              <option value="REVIEW_UNCLASSIFIED">Đưa vào Review</option>
              <option value="PFM_INCLUDED">Đưa vào scope này</option>
            </select>
          </label>
        </div>
        <div className="cardActions">
          <span className="helperText">Plan Target không tự đổi theo benchmark. Scope đầu tiên giữ tương thích với project cũ.</span>
          {scopes.length > 1 && <button className="dangerAction" onClick={removeScope}><Trash2 size={15} /> Xóa scope</button>}
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">GEOMETRIC WINDOW SCORE</span>
            <h2>Window động của {selected.name}</h2>
            <p>Chỉ window bật “Trong score” mới tham gia trung bình nhân. Diagnostic vẫn hiển thị trend.</p>
          </div>
          <span className={`statusBadge ${Math.abs(scoreWeight - 1) < 0.0001 ? "success" : "danger"}`}>{Math.round(scoreWeight * 100)}%</span>
        </div>
        <div className="windowGrid dynamicWindows">
          {selected.windows.map((window, index) => (
            <article key={window.id}>
              <div className="windowCardTitle"><strong>{window.label ?? window.id}</strong><button className="iconAction dangerIcon" onClick={() => removeWindow(index)}><Trash2 size={14} /></button></div>
              <label>Tên<input value={window.label ?? window.id} onChange={(event) => patchWindow(index, { label: event.target.value })} /></label>
              <label>Loại
                <select value={window.kind ?? "ROLLING"} onChange={(event) => patchWindow(index, { kind: event.target.value as WindowConfig["kind"], days: event.target.value === "ROLLING" ? window.days ?? 3 : null })}>
                  <option value="TODAY">Today</option><option value="ROLLING">Rolling</option><option value="LIFETIME">Lifetime</option>
                </select>
              </label>
              <label>Days<input type="number" min="1" disabled={(window.kind ?? "ROLLING") !== "ROLLING"} value={window.days ?? ""} onChange={(event) => patchWindow(index, { days: Number(event.target.value) || null })} /></label>
              <label>Vai trò
                <select value={window.role} onChange={(event) => patchWindow(index, { role: event.target.value as WindowConfig["role"] })}>
                  <option value="SIGNAL">Signal</option><option value="CONFIRMATION">Confirmation</option><option value="BASELINE">Baseline</option><option value="DIAGNOSTIC">Diagnostic</option>
                </select>
              </label>
              <label>Weight %<input type="number" min="0" max="100" disabled={!window.includeInScore} value={Math.round(window.weight * 100)} onChange={(event) => patchWindow(index, { weight: Number(event.target.value) / 100 })} /></label>
              <label>Min spend<input type="number" min="0" value={window.minSpend} onChange={(event) => patchWindow(index, { minSpend: Number(event.target.value) })} /></label>
              <label>Min result<input type="number" min="0" value={window.minResults} onChange={(event) => patchWindow(index, { minResults: Number(event.target.value) })} /></label>
              <label>Red flag dưới %<input type="number" min="0" max="1000" value={window.redFlagThreshold === null ? "" : window.redFlagThreshold * 100} onChange={(event) => patchWindow(index, { redFlagThreshold: event.target.value === "" ? null : Number(event.target.value) / 100 })} /></label>
              <label className="checkboxLine"><input type="checkbox" checked={window.includeInScore} onChange={(event) => patchWindow(index, { includeInScore: event.target.checked, weight: event.target.checked ? window.weight : 0 })} /> Trong score</label>
              <label className="checkboxLine"><input type="checkbox" checked={window.required} onChange={(event) => patchWindow(index, { required: event.target.checked })} /> Required</label>
            </article>
          ))}
        </div>
        <div className="cardActions">
          <button className="secondaryAction" onClick={addWindow}><Plus size={15} /> Thêm window</button>
          <button className="secondaryAction" onClick={normalizeWeights}><RefreshCw size={15} /> Normalize weights</button>
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader">
          <div><span className="sectionKicker">COHORT BENCHMARK</span><h2>So sánh Plan và mặt bằng cùng scope</h2><p>Benchmark không thay Plan Target; engine hiển thị hai score song song.</p></div>
        </div>
        <div className="formGrid">
          <label className="checkboxLine"><input type="checkbox" checked={selected.cohortBenchmark.enabled} onChange={(event) => patchScope({ cohortBenchmark: { ...selected.cohortBenchmark, enabled: event.target.checked } })} /> Bật Cohort Benchmark</label>
          <label>Lookback days<input type="number" min="1" value={selected.cohortBenchmark.lookbackDays} onChange={(event) => patchScope({ cohortBenchmark: { ...selected.cohortBenchmark, lookbackDays: Number(event.target.value) } })} /></label>
          <label>Minimum entities<input type="number" min="1" value={selected.cohortBenchmark.minEntities} onChange={(event) => patchScope({ cohortBenchmark: { ...selected.cohortBenchmark, minEntities: Number(event.target.value) } })} /></label>
          <label>Minimum results<input type="number" min="0" value={selected.cohortBenchmark.minResults} onChange={(event) => patchScope({ cohortBenchmark: { ...selected.cohortBenchmark, minResults: Number(event.target.value) } })} /></label>
          <label>Method
            <select value={selected.cohortBenchmark.method} onChange={(event) => patchScope({ cohortBenchmark: { ...selected.cohortBenchmark, method: event.target.value as "AGGREGATE" | "MEDIAN" } })}>
              <option value="AGGREGATE">Total Spend / Total Result</option><option value="MEDIAN">Median entity KPI</option>
            </select>
          </label>
          <label>Manual benchmark (để trống = auto)<input type="number" min="0" value={selected.cohortBenchmark.manualValue ?? ""} onChange={(event) => patchScope({ cohortBenchmark: { ...selected.cohortBenchmark, manualValue: event.target.value ? Number(event.target.value) : null } })} /></label>
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHeader">
          <div><span className="sectionKicker">PFM CLASSIFIER</span><h2>Naming → Scope / Non-PFM</h2><p>Rule có priority cao thắng trước. Dữ liệu chưa khớp được đưa vào Review thay vì tự đoán.</p></div>
          <div className="topbarActions">
            <button className="secondaryAction" onClick={() => addClassificationRule("PFM_INCLUDED")}><Plus size={15} /> Rule PFM</button>
            <button className="secondaryAction" onClick={() => addClassificationRule("NON_PFM_EXCLUDED")}><Plus size={15} /> Rule loại</button>
          </div>
        </div>
        <p className="scopeHint">Field thường dùng: <code>entityName</code>, <code>objective</code>, <code>dimensions.campaignName</code>, <code>dimensions.kpiMetric</code>, <code>dimensions.funnel</code>. Dùng CONTAINS cho token trong naming; dùng EQUALS/IN cho cột đã chuẩn hóa.</p>
        <div className="classificationRows">
          {rulesForScope.length === 0 && <p className="emptyMapping">Chưa có rule naming. Scope fallback hiện tại sẽ quyết định dữ liệu unmatched.</p>}
          {rulesForScope.map((rule) => (
            <div className="classificationRow" key={rule.id}>
              <input value={rule.name} onChange={(event) => patchClassification(rule.id, { name: event.target.value })} />
              <input value={rule.field} onChange={(event) => patchClassification(rule.id, { field: event.target.value })} placeholder="dimensions.kpiMetric" />
              <select value={rule.operator} onChange={(event) => patchClassification(rule.id, { operator: event.target.value as ClassificationRule["operator"] })}>
                <option value="IN">IN</option><option value="EQUALS">Equals</option><option value="CONTAINS">Contains</option><option value="REGEX">Regex</option>
              </select>
              <input value={rule.values.join(", ")} onChange={(event) => patchClassification(rule.id, { values: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} />
              <select value={rule.outcome} onChange={(event) => patchClassification(rule.id, {
                outcome: event.target.value as ClassificationRule["outcome"],
                scopeId: event.target.value === "PFM_INCLUDED" ? selected.scopeId : null
              })}>
                <option value="PFM_INCLUDED">PFM → {selected.name}</option><option value="NON_PFM_EXCLUDED">Non-PFM</option>
              </select>
              <input type="number" value={rule.priority} onChange={(event) => patchClassification(rule.id, { priority: Number(event.target.value) })} />
              <button className="iconAction dangerIcon" onClick={() => removeClassification(rule.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
