import { z } from "zod";
import { factRowSchema, type FactRow } from "./schemas";

export const canonicalFieldSchema = z.enum([
  "projectId", "platform", "accountId", "date", "hour", "entityLevel",
  "campaignId", "adsetId", "adId", "entityName", "status", "budgetType",
  "budget", "spend", "result", "qualifiedResult", "revenue", "impressions",
  "clicks", "sourceUpdatedAt"
]);
export type CanonicalField = z.infer<typeof canonicalFieldSchema>;
export type SourceMapping = { canonicalField: CanonicalField; sourceColumn: string; required: boolean; defaultValue?: unknown };
export type SupportingMetricMapping = { metricKey: string; sourceColumn: string };
export type DimensionMapping = {
  dimensionKey: "objective" | "optimizationGoal" | "learningStatus" | "postId" | string;
  sourceColumn: string;
};
export type NormalizeContext = {
  projectId: string;
  platform: string;
  accountId: string;
  mappings: SourceMapping[];
  metricMappings?: SupportingMetricMapping[];
  dimensionMappings?: DimensionMapping[];
};
export type NormalizeError = { row: number; field: string; code: string; value: unknown };

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let normalized = String(value).trim().replace(/[^\d.,-]/g, "");
  if (!normalized) return null;
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.split(thousandsSeparator).join("");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    const commaCount = (normalized.match(/,/g) ?? []).length;
    const digitsAfter = normalized.length - lastComma - 1;
    normalized = commaCount > 1 || digitsAfter === 3
      ? normalized.replace(/,/g, "")
      : normalized.replace(",", ".");
  } else if (lastDot >= 0) {
    const dotCount = (normalized.match(/\./g) ?? []).length;
    const digitsAfter = normalized.length - lastDot - 1;
    if (dotCount > 1 || digitsAfter === 3) normalized = normalized.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  let str = value.trim();
  if (!str) return null;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(str)) {
    str = `${str.replace(/\//g, "-")}T00:00:00Z`;
  } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]00:00(:00)?$/.test(str)) {
    const datePart = str.split(/[\sT]/)[0].replace(/\//g, "-");
    str = `${datePart}T00:00:00Z`;
  }
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isoDateTime(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeRows(rawRows: Record<string, unknown>[], context: NormalizeContext): { facts: FactRow[]; errors: NormalizeError[] } {
  const facts: FactRow[] = []; const errors: NormalizeError[] = [];
  rawRows.forEach((raw, index) => {
    const value: Record<string, unknown> = { projectId: context.projectId, platform: context.platform, accountId: context.accountId };
    for (const mapping of context.mappings) {
      const source = raw[mapping.sourceColumn] ?? mapping.defaultValue ?? null;
      if (mapping.required && (source === null || source === undefined || source === "")) errors.push({ row: index + 2, field: mapping.canonicalField, code: "REQUIRED_VALUE_MISSING", value: source });
      value[mapping.canonicalField] = source;
    }
    value.metrics = Object.fromEntries((context.metricMappings ?? []).map((mapping) => [
      mapping.metricKey,
      numberOrNull(raw[mapping.sourceColumn])
    ]));
    const dimensions = Object.fromEntries((context.dimensionMappings ?? []).map((mapping) => [
      mapping.dimensionKey,
      raw[mapping.sourceColumn] === null || raw[mapping.sourceColumn] === undefined || raw[mapping.sourceColumn] === ""
        ? null
        : String(raw[mapping.sourceColumn])
    ]));
    value.dimensions = dimensions;
    value.objective = dimensions.objective ?? null;
    value.optimizationGoal = dimensions.optimizationGoal ?? null;
    value.learningStatus = dimensions.learningStatus ?? null;
    value.postId = dimensions.postId ?? null;
    for (const field of ["budget", "spend", "result", "qualifiedResult", "revenue", "impressions", "clicks"] as const) value[field] = numberOrNull(value[field]);
    value.hour = numberOrNull(value.hour);
    value.date = isoDate(value.date);
    value.sourceUpdatedAt = isoDateTime(value.sourceUpdatedAt);
    value.entityLevel = String(value.entityLevel ?? "").trim().toUpperCase().replace("AD SET", "ADSET");
    value.budgetType = String(value.budgetType ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    value.status = String(value.status ?? "UNKNOWN").trim().toUpperCase();
    for (const field of ["campaignId", "adsetId", "adId", "entityName"] as const) value[field] = value[field] === null || value[field] === undefined || value[field] === "" ? null : String(value[field]);
    value.sourceRowKey = [
      context.projectId, value.date, value.hour ?? "", value.entityLevel,
      value.campaignId ?? "", value.adsetId ?? "", value.adId ?? ""
    ].join("|");
    value.projectId = context.projectId;
    value.platform = context.platform;
    value.accountId = context.accountId;
    const parsed = factRowSchema.safeParse(value);
    if (parsed.success) facts.push(parsed.data);
    else for (const issue of parsed.error.issues) errors.push({ row: index + 2, field: issue.path.join("."), code: issue.code, value: issue.path.reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value) });
  });
  const counts = new Map<string, number>();
  for (const fact of facts) counts.set(fact.sourceRowKey, (counts.get(fact.sourceRowKey) ?? 0) + 1);
  const duplicateKeys = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  if (duplicateKeys.size) {
    facts.forEach((fact, index) => {
      if (duplicateKeys.has(fact.sourceRowKey)) errors.push({ row: index + 2, field: "sourceRowKey", code: "DUPLICATE_SOURCE_KEY_IN_IMPORT", value: fact.sourceRowKey });
    });
  }
  return { facts: facts.filter((fact) => !duplicateKeys.has(fact.sourceRowKey)), errors };
}
