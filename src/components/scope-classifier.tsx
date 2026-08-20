"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { ClassificationRule, FactRow, OptimizationScope } from "@/core/schemas";
import { formatNumber } from "./helpers/format-utils";

/**
 * Splitting an account by objective used to mean writing a rule by hand: a
 * field path, an operator, a comma-separated value list and a priority number.
 * Every one of those is a chance to be wrong in a way nothing on screen would
 * catch — and the operator has the answer already, in a column of their sheet.
 *
 * So this asks the two questions they can actually answer. Which column says
 * what an ad is for, and which of its values belong to which KPI group. The
 * values are read from the imported data, with their row count and spend, so
 * there is nothing to type and nothing to spell wrong.
 */

export type ScopeClassifierProps = {
  facts: FactRow[];
  scopes: OptimizationScope[];
  rules: ClassificationRule[];
  onChange: (rules: ClassificationRule[]) => void;
  onCreateScopeForValue: (value: string, field: string) => void;
  currency: string;
};

const MAX_VALUES = 60;

/** Columns worth offering: low-cardinality labels, not names or ids. */
function candidateColumns(facts: FactRow[]): Array<{ field: string; label: string; distinct: number }> {
  const counters = new Map<string, Set<string>>();
  const note = (field: string, value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return;
    const existing = counters.get(field) ?? new Set<string>();
    existing.add(text);
    counters.set(field, existing);
  };
  for (const fact of facts) {
    note("objective", fact.objective);
    note("optimizationGoal", fact.optimizationGoal);
    for (const [key, value] of Object.entries(fact.dimensions ?? {})) note(`dimensions.${key}`, value);
  }
  return [...counters.entries()]
    .map(([field, values]) => ({
      field,
      label: field.startsWith("dimensions.") ? field.slice("dimensions.".length) : field,
      distinct: values.size
    }))
    .filter((item) => item.distinct > 1 && item.distinct <= 200)
    .sort((a, b) => a.distinct - b.distinct);
}

function readField(fact: FactRow, field: string): string {
  if (field.startsWith("dimensions.")) return String(fact.dimensions?.[field.slice("dimensions.".length)] ?? "").trim();
  if (field === "objective") return String(fact.objective ?? "").trim();
  if (field === "optimizationGoal") return String(fact.optimizationGoal ?? "").trim();
  return "";
}

const ruleIdFor = (field: string, value: string) =>
  `auto-${field}-${value}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);

export function ScopeClassifier({
  facts, scopes, rules, onChange, onCreateScopeForValue, currency
}: ScopeClassifierProps) {
  const columns = useMemo(() => candidateColumns(facts), [facts]);
  const assignedField = rules.find((rule) => rule.id.startsWith("auto-"))?.field;
  const [field, setField] = useState(assignedField ?? columns[0]?.field ?? "");

  const values = useMemo(() => {
    if (!field) return [];
    const totals = new Map<string, { rows: number; spend: number }>();
    for (const fact of facts) {
      const value = readField(fact, field);
      if (!value) continue;
      const current = totals.get(value) ?? { rows: 0, spend: 0 };
      current.rows += 1;
      current.spend += fact.spend;
      totals.set(value, current);
    }
    return [...totals.entries()]
      .map(([value, item]) => ({ value, ...item }))
      .sort((a, b) => b.spend - a.spend);
  }, [facts, field]);

  const assignmentOf = (value: string): string => {
    const rule = rules.find((item) => item.id === ruleIdFor(field, value));
    if (!rule) return "NONE";
    return rule.outcome === "NON_PFM_EXCLUDED" ? "EXCLUDED" : rule.scopeId ?? "NONE";
  };

  function assign(value: string, target: string) {
    const id = ruleIdFor(field, value);
    const without = rules.filter((rule) => rule.id !== id);
    if (target === "NONE") return onChange(without);
    onChange([...without, {
      id,
      name: `${value} → ${target === "EXCLUDED" ? "không chấm" : scopes.find((s) => s.scopeId === target)?.name ?? target}`,
      field,
      operator: "EQUALS",
      values: [value],
      outcome: target === "EXCLUDED" ? "NON_PFM_EXCLUDED" : "PFM_INCLUDED",
      scopeId: target === "EXCLUDED" ? null : target,
      priority: 100,
      enabled: true
    }]);
  }

  const assignedCount = values.filter((item) => assignmentOf(item.value) !== "NONE").length;
  const unassignedSpend = values
    .filter((item) => assignmentOf(item.value) === "NONE")
    .reduce((sum, item) => sum + item.spend, 0);

  if (!facts.length) {
    return (
      <section className="sectionCard">
        <div className="sectionHeader">
          <div>
            <span className="sectionKicker">Tách theo cột</span>
            <h2>Nhóm nào chấm dòng nào</h2>
            <p>Import dữ liệu trước, rồi quay lại đây chọn cột và giá trị.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sectionCard">
      <div className="sectionHeader">
        <div>
          <span className="sectionKicker">Tách theo cột</span>
          <h2>Nhóm nào chấm dòng nào</h2>
          <p>
            Chọn cột cho biết mỗi dòng chạy objective gì, rồi gán từng giá trị vào một nhóm KPI.
            Giá trị đọc thẳng từ dữ liệu đã import, không phải gõ tay.
          </p>
        </div>
        <label className="columnPicker">
          Cột xác định objective
          <select value={field} onChange={(event) => setField(event.target.value)}>
            {columns.length === 0 && <option value="">Chưa có cột nào phù hợp</option>}
            {columns.map((column) => (
              <option key={column.field} value={column.field}>
                {column.label} · {column.distinct} giá trị
              </option>
            ))}
          </select>
        </label>
      </div>

      {columns.length === 0 ? (
        <p className="scopeHint">
          Dữ liệu chưa có cột nào dùng để tách được. Vào <b>Data import</b> map cột objective
          trong sheet thành một dimension, rồi quay lại đây.
        </p>
      ) : (
        <>
          <div className="tableScroller">
            <table className="valueTable">
              <thead>
                <tr>
                  <th>Giá trị trong cột</th>
                  <th className="numeric">Số dòng</th>
                  <th className="numeric">Chi tiêu</th>
                  <th>Chấm bằng nhóm KPI</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {values.slice(0, MAX_VALUES).map((item) => {
                  const assignment = assignmentOf(item.value);
                  return (
                    <tr key={item.value} className={assignment === "NONE" ? "unassigned" : ""}>
                      <td><strong>{item.value}</strong></td>
                      <td className="numeric mono">{item.rows.toLocaleString("vi-VN")}</td>
                      <td className="numeric mono">{formatNumber(item.spend, currency)}</td>
                      <td>
                        <select value={assignment} onChange={(event) => assign(item.value, event.target.value)}>
                          <option value="NONE">Chưa gán</option>
                          {scopes.map((scope) => (
                            <option key={scope.scopeId} value={scope.scopeId}>{scope.name}</option>
                          ))}
                          <option value="EXCLUDED">Bỏ qua, không chấm</option>
                        </select>
                      </td>
                      <td>
                        {assignment === "NONE" && (
                          <button
                            className="ghostAction"
                            onClick={() => onCreateScopeForValue(item.value, field)}
                          >
                            <Plus size={14} /> Tạo nhóm riêng
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {values.length > MAX_VALUES && (
            <p className="scopeHint">
              Đang hiện {MAX_VALUES} giá trị tiêu nhiều nhất trong tổng số {values.length}.
              Cột này có vẻ không phải cột objective.
            </p>
          )}
          <div className="cardActions">
            <span className="helperText">
              {assignedCount === 0
                ? "Chưa gán giá trị nào. Mọi dòng đang chấm theo cài đặt mặc định của scope."
                : `Đã gán ${assignedCount}/${values.length} giá trị.`}
              {unassignedSpend > 0 && assignedCount > 0
                && ` Còn ${formatNumber(unassignedSpend, currency)} chi tiêu chưa thuộc nhóm nào.`}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
