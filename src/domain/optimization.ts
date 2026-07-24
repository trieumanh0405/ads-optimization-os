import type { ActionCode, EntityLevel } from "./types";

export type EntityMetric = { id: string; level: EntityLevel; name: string; spend: number; results: number; metric: number | null; impressions?: number; clicks?: number };
export type AppRuleConfig = { target: number; minSpendMultiplier: number; increaseBelowPct: number; decreaseAbovePct: number; turnOffAbovePct: number; increasePct: number; decreasePct: number };
export type AppDecision = EntityMetric & { action: ActionCode; adjustmentPct?: number; confidence: "Low" | "Medium" | "High"; reason: string; status: "PENDING" | "DONE" | "REJECTED" | "DEFERRED" };

export const defaultRuleConfig: AppRuleConfig = { target: 320000, minSpendMultiplier: 1.25, increaseBelowPct: 80, decreaseAbovePct: 120, turnOffAbovePct: 160, increasePct: 15, decreasePct: 10 };

export function optimizeEntity(entity: EntityMetric, config: AppRuleConfig): AppDecision {
  if (entity.metric === null || entity.results < 1 || entity.spend < config.target * config.minSpendMultiplier) {
    return { ...entity, action: "PENDING_DATA", confidence: "Low", reason: "Chưa đạt minimum evidence", status: "PENDING" };
  }
  const ratio = (entity.metric / config.target) * 100;
  if (ratio >= config.turnOffAbovePct) return { ...entity, action: "TURN_OFF", confidence: entity.results >= 3 ? "High" : "Medium", reason: `CPA bằng ${ratio.toFixed(0)}% target · Đủ min spend`, status: "PENDING" };
  if (ratio >= config.decreaseAbovePct && entity.level !== "ad") return { ...entity, action: "DECREASE_BUDGET", adjustmentPct: config.decreasePct, confidence: "Medium", reason: `CPA vượt target ${(ratio - 100).toFixed(0)}%`, status: "PENDING" };
  if (ratio <= config.increaseBelowPct && entity.level !== "ad") return { ...entity, action: "INCREASE_BUDGET", adjustmentPct: config.increasePct, confidence: entity.results >= 3 ? "High" : "Medium", reason: `CPA đạt ${ratio.toFixed(0)}% target`, status: "PENDING" };
  return { ...entity, action: "KEEP", confidence: entity.results >= 3 ? "High" : "Medium", reason: `CPA đạt ${ratio.toFixed(0)}% target`, status: "PENDING" };
}

export function parseEntityCsv(text: string): EntityMetric[] {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("CSV phải có header và ít nhất một dòng dữ liệu.");
  const headers = rows[0].split(",").map((value) => value.trim().toLowerCase());
  for (const column of ["entity_id", "entity_level", "entity_name", "spend", "results"]) if (!headers.includes(column)) throw new Error(`Thiếu cột bắt buộc: ${column}`);
  return rows.slice(1).map((row, index) => {
    const values = row.split(",").map((value) => value.trim());
    const get = (key: string) => values[headers.indexOf(key)] ?? "";
    const level = get("entity_level").toLowerCase();
    if (!["campaign", "adset", "ad"].includes(level)) throw new Error(`Dòng ${index + 2}: entity_level không hợp lệ`);
    const spend = Number(get("spend")); const results = Number(get("results")); const explicit = get("metric_value");
    if (!Number.isFinite(spend) || !Number.isFinite(results)) throw new Error(`Dòng ${index + 2}: spend/results không hợp lệ`);
    return { id: get("entity_id"), level: level as EntityLevel, name: get("entity_name"), spend, results, metric: explicit ? Number(explicit) : results > 0 ? spend / results : null, impressions: Number(get("impressions")) || undefined, clicks: Number(get("clicks")) || undefined };
  });
}
