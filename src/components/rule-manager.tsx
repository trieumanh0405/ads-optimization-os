"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { optimizationRuleSchema, type OptimizationRule, type OptimizationScope } from "@/core/schemas";
import { resolvedScopes } from "@/core/scopes";
import { canonicalScoreSource } from "@/core/rules";
import { buildDefaultRules } from "@/product/defaults";
import type { LocalProject } from "@/product/types";

type Props = {
  project: LocalProject;
  onUpdate: (project: LocalProject) => void;
  notify: (message: string, tone?: "success" | "error") => void;
};

function blankRule(scope: OptimizationScope): OptimizationRule {
  return {
    id: `rule-${crypto.randomUUID().slice(0, 8)}`,
    name: "Rule mới",
    description: "",
    ruleSetId: scope.ruleSetId,
    version: scope.ruleVersion,
    entityLevel: "AD",
    metricKey: scope.primaryMetricKey,
    scoreSource: "GEOMETRIC",
    evaluationField: "ACHIEVEMENT",
    evidenceSource: "ALL_SCORE_WINDOWS",
    minSpendAbsolute: null,
    minSpendTargetMultiple: null,
    minResults: 1,
    operator: "LT",
    thresholdFrom: 0.8,
    thresholdTo: null,
    actionCode: "TURN_OFF",
    actionValue: null,
    priority: 50,
    enabled: true
  };
}

function canonicalRule(rule: OptimizationRule): OptimizationRule {
  return { ...rule, scoreSource: canonicalScoreSource(rule.scoreSource) };
}

export function RuleManager({ project, onUpdate, notify }: Props) {
  const scopes = resolvedScopes(project.config);
  const [selectedScopeId, setSelectedScopeId] = useState(scopes[0]?.scopeId ?? "");
  const selectedScope = scopes.find((scope) => scope.scopeId === selectedScopeId) ?? scopes[0];
  const scopedRules = project.rules.filter((rule) => rule.ruleSetId === selectedScope.ruleSetId);
  const [selectedId, setSelectedId] = useState<string | null>(scopedRules[0]?.id ?? null);
  const selected = useMemo(
    () => scopedRules.find((rule) => rule.id === selectedId) ?? null,
    [scopedRules, selectedId]
  );
  const [draft, setDraft] = useState<OptimizationRule>(() => selected ? canonicalRule(selected) : blankRule(selectedScope));

  useEffect(() => {
    if (selected) setDraft(structuredClone(canonicalRule(selected)));
  }, [selected]);

  function chooseScope(scopeId: string) {
    const scope = scopes.find((item) => item.scopeId === scopeId);
    if (!scope) return;
    const first = project.rules.find((rule) => rule.ruleSetId === scope.ruleSetId);
    setSelectedScopeId(scopeId);
    setSelectedId(first?.id ?? null);
    setDraft(structuredClone(first ? canonicalRule(first) : blankRule(scope)));
  }

  function addRule() {
    const rule = blankRule(selectedScope);
    onUpdate({ ...project, rules: [...project.rules, rule], updatedAt: new Date().toISOString() });
    setSelectedId(rule.id);
  }

  function duplicateRule() {
    if (!selected) return;
    const rule = {
      ...structuredClone(selected),
      id: `${selected.id}-copy-${Date.now().toString(36).slice(-4)}`,
      name: `${selected.name ?? selected.id} · copy`
    };
    onUpdate({ ...project, rules: [...project.rules, rule], updatedAt: new Date().toISOString() });
    setSelectedId(rule.id);
  }

  function removeRule() {
    if (!selected) return;
    if (!window.confirm(`Xóa rule "${selected.name ?? selected.id}"?`)) return;
    const next = project.rules.filter((rule) =>
      !(rule.id === selected.id && rule.ruleSetId === selected.ruleSetId)
    );
    onUpdate({ ...project, rules: next, updatedAt: new Date().toISOString() });
    setSelectedId(next.find((rule) => rule.ruleSetId === selectedScope.ruleSetId)?.id ?? null);
    notify("Đã xóa rule.");
  }

  function saveRule() {
    const parsed = optimizationRuleSchema.safeParse({
      ...draft,
      metricKey: selectedScope.primaryMetricKey,
      ruleSetId: selectedScope.ruleSetId,
      version: selectedScope.ruleVersion
    });
    if (!parsed.success) {
      notify(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" · "), "error");
      return;
    }
    const exists = project.rules.some((rule) =>
      rule.id === parsed.data.id && rule.ruleSetId === parsed.data.ruleSetId
    );
    const nextRules = exists
      ? project.rules.map((rule) =>
        rule.id === parsed.data.id && rule.ruleSetId === parsed.data.ruleSetId ? parsed.data : rule
      )
      : [...project.rules, parsed.data];
    onUpdate({ ...project, rules: nextRules, updatedAt: new Date().toISOString() });
    setSelectedId(parsed.data.id);
    notify("Đã lưu rule.");
  }

  function resetRules() {
    if (!window.confirm("Tạo lại rule mặc định cho scope đang chọn? Rule custom trong scope này sẽ bị thay thế.")) return;
    const rules = buildDefaultRules(selectedScope.primaryMetricKey, selectedScope.ruleSetId, selectedScope.windows);
    const otherRules = project.rules.filter((rule) => rule.ruleSetId !== selectedScope.ruleSetId);
    onUpdate({ ...project, rules: [...otherRules, ...rules], updatedAt: new Date().toISOString() });
    setSelectedId(rules[0]?.id ?? null);
    notify("Đã tạo lại rule mặc định.");
  }

  function patch<K extends keyof OptimizationRule>(key: K, value: OptimizationRule[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="rulesLayout">
      <section className="sectionCard rulesList">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">RULE LIBRARY · V{selectedScope.ruleVersion}</span>
            <h2>{scopedRules.length} rule · {selectedScope.name}</h2>
            <p>Rule là record có version; không có magic number trong UI.</p>
          </div>
          <button className="iconAction" onClick={addRule} aria-label="Thêm rule"><Plus size={18} /></button>
        </div>
        <div className="scopeTabs">
          {scopes.map((scope) => (
            <button key={scope.scopeId} className={scope.scopeId === selectedScope.scopeId ? "active" : ""} onClick={() => chooseScope(scope.scopeId)}>
              <strong>{scope.name}</strong><small>{scope.primaryMetricKey}</small>
            </button>
          ))}
        </div>
        <div className="ruleRows">
          {scopedRules.map((rule) => (
            <button
              key={rule.id}
              className={`ruleRow ${selectedId === rule.id ? "active" : ""}`}
              onClick={() => setSelectedId(rule.id)}
            >
              <span className={`levelPill ${rule.entityLevel.toLowerCase()}`}>{rule.entityLevel}</span>
              <span>
                <strong>{rule.name ?? rule.id}</strong>
                <small>{canonicalScoreSource(rule.scoreSource)} · {rule.operator} {rule.thresholdFrom}</small>
              </span>
              <span className={`actionPill action-${rule.actionCode.toLowerCase()}`}>{rule.actionCode}</span>
              <i className={rule.enabled ? "enabledDot" : "disabledDot"} />
            </button>
          ))}
        </div>
        <div className="cardActions wrap">
          <button className="secondaryAction" onClick={resetRules}><RotateCcw size={15} /> Reset mặc định</button>
          <button className="secondaryAction" onClick={duplicateRule} disabled={!selected}><Copy size={15} /> Nhân bản</button>
          <button className="dangerAction" onClick={removeRule} disabled={!selected}><Trash2 size={15} /> Xóa</button>
        </div>
      </section>

      <section className="sectionCard ruleEditor">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">RULE EDITOR</span>
            <h2>{selected ? "Chỉnh rule" : "Tạo rule"}</h2>
            <p>Achievement luôn được chuẩn hóa về hướng “cao hơn là tốt”.</p>
          </div>
          <label className="switchLabel">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => patch("enabled", event.target.checked)} />
            Enabled
          </label>
        </div>
        <div className="formGrid">
          <label>Tên rule
            <input value={draft.name ?? ""} onChange={(event) => patch("name", event.target.value)} />
          </label>
          <label>Rule ID
            <input className="mono" value={draft.id} onChange={(event) => patch("id", event.target.value)} />
          </label>
          <label>Cấp entity
            <select value={draft.entityLevel} onChange={(event) => patch("entityLevel", event.target.value as OptimizationRule["entityLevel"])}>
              <option value="CAMPAIGN">Campaign</option>
              <option value="ADSET">Ad set</option>
              <option value="AD">Ad</option>
            </select>
          </label>
          <label>Giá trị được so sánh
            <select value={draft.evaluationField} onChange={(event) => patch("evaluationField", event.target.value as OptimizationRule["evaluationField"])}>
              <option value="ACHIEVEMENT">Achievement</option>
              <option value="METRIC_VALUE">Giá trị KPI thật</option>
              <option value="SPEND">Spend</option>
              <option value="RESULTS">Results</option>
              <option value="QUALIFIED_RESULTS">Qualified results</option>
              <option value="REVENUE">Revenue</option>
            </select>
          </label>
          <label>Score / metric window
            <select value={draft.scoreSource} onChange={(event) => patch("scoreSource", event.target.value as OptimizationRule["scoreSource"])}>
              <option value="GEOMETRIC">Plan geometric score</option>
              <option value="COHORT_GEOMETRIC">Cohort geometric score</option>
              <option value="CONTEXT_GEOMETRIC">Project / parent context</option>
              <option value="MIN_WINDOW">Window thấp nhất</option>
              <option value="TREND">Signal / baseline trend</option>
              {selectedScope.windows.map((window) => <option key={window.id} value={window.id}>{window.label ?? window.id}</option>)}
            </select>
          </label>
          <label>Evidence window
            <select value={draft.evidenceSource} onChange={(event) => patch("evidenceSource", event.target.value as OptimizationRule["evidenceSource"])}>
              <option value="ALL_SCORE_WINDOWS">Tất cả window trong score</option>
              {selectedScope.windows.map((window) => <option key={window.id} value={window.id}>{window.label ?? window.id}</option>)}
            </select>
          </label>
          <label>Minimum spend tuyệt đối
            <input type="number" min="0" value={draft.minSpendAbsolute ?? ""} onChange={(event) => patch("minSpendAbsolute", event.target.value === "" ? null : Number(event.target.value))} />
          </label>
          <label>Minimum spend × target
            <input type="number" min="0" step="0.1" value={draft.minSpendTargetMultiple ?? ""} onChange={(event) => patch("minSpendTargetMultiple", event.target.value === "" ? null : Number(event.target.value))} />
          </label>
          <label>Minimum results
            <input type="number" min="0" value={draft.minResults} onChange={(event) => patch("minResults", Number(event.target.value))} />
          </label>
          <label>Operator
            <select value={draft.operator} onChange={(event) => patch("operator", event.target.value as OptimizationRule["operator"])}>
              <option value="LT">&lt;</option>
              <option value="LTE">≤</option>
              <option value="GT">&gt;</option>
              <option value="GTE">≥</option>
              <option value="BETWEEN">Trong khoảng</option>
            </select>
          </label>
          <label>Threshold from
            <input type="number" step="0.01" value={draft.thresholdFrom} onChange={(event) => patch("thresholdFrom", Number(event.target.value))} />
          </label>
          <label>Threshold to
            <input type="number" step="0.01" disabled={draft.operator !== "BETWEEN"} value={draft.thresholdTo ?? ""} onChange={(event) => patch("thresholdTo", event.target.value === "" ? null : Number(event.target.value))} />
          </label>
          <label>Action
            <select value={draft.actionCode} onChange={(event) => patch("actionCode", event.target.value as OptimizationRule["actionCode"])}>
              <option value="PENDING_DATA">Pending data</option>
              <option value="KEEP">Keep</option>
              <option value="TURN_OFF">Turn off</option>
              <option value="DECREASE_BUDGET">Decrease budget</option>
              <option value="INCREASE_BUDGET">Increase budget</option>
              <option value="REVIEW_MANUALLY">Review manually</option>
            </select>
          </label>
          <label>Adjustment %
            <input type="number" min="-100" max="100" value={draft.actionValue === null ? "" : draft.actionValue * 100} onChange={(event) => patch("actionValue", event.target.value === "" ? null : Number(event.target.value) / 100)} />
          </label>
          <label>Priority
            <input type="number" value={draft.priority} onChange={(event) => patch("priority", Number(event.target.value))} />
          </label>
          <label className="fullWidth">Mô tả / lý do
            <textarea value={draft.description ?? ""} onChange={(event) => patch("description", event.target.value)} />
          </label>
        </div>
        <div className="cardActions">
          <span className="helperText">Rule cùng priority nhưng action trái nhau sẽ trả về REVIEW_MANUALLY.</span>
          <button className="primaryAction" onClick={saveRule}><Save size={16} /> Lưu rule</button>
        </div>
      </section>
    </div>
  );
}
