import type { EngineRequest, FactRow } from "./schemas";
import { entityId } from "./windows";
import { classifyFacts, resolvedScopes } from "./scopes";

export type QcIssue = { code: string; severity: "FATAL" | "WARNING"; message: string; sourceRowKeys?: string[] };
export type QcResult = { status: "PASS" | "WARNING" | "FAIL"; issues: QcIssue[]; latestSourceUpdateAt: string | null };

export function runDataQualityChecks(request: EngineRequest): QcResult {
  const issues: QcIssue[] = [];
  if (!request.facts.length) issues.push({ code: "RAW_DATA_EMPTY", severity: "FATAL", message: "No normalized fact rows were provided." });
  const keys = new Map<string, number>();
  for (const row of request.facts) keys.set(row.sourceRowKey, (keys.get(row.sourceRowKey) ?? 0) + 1);
  const duplicates = [...keys].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length) issues.push({ code: "DUPLICATE_SOURCE_KEYS", severity: "FATAL", message: `${duplicates.length} duplicate source keys.`, sourceRowKeys: duplicates });
  const missingIds = request.facts.filter((row) => !entityId(row)).map((row) => row.sourceRowKey);
  if (missingIds.length) issues.push({ code: "MISSING_ENTITY_ID", severity: "FATAL", message: `${missingIds.length} rows have no ID for their entity level.`, sourceRowKeys: missingIds });
  const brokenHierarchy = request.facts.filter((row) =>
    (row.entityLevel === "ADSET" && !row.adsetId)
    || (row.entityLevel === "AD" && (!row.adsetId || !row.adId))
  ).map((row) => row.sourceRowKey);
  if (brokenHierarchy.length) issues.push({ code: "BROKEN_ENTITY_HIERARCHY", severity: "FATAL", message: `${brokenHierarchy.length} rows are missing a parent/entity ID.`, sourceRowKeys: brokenHierarchy });
  const wrongProject = request.facts.filter((row) => row.projectId !== request.config.projectId).map((row) => row.sourceRowKey);
  if (wrongProject.length) issues.push({ code: "PROJECT_ID_MISMATCH", severity: "FATAL", message: "Fact rows contain a different projectId.", sourceRowKeys: wrongProject });
  const wrongAccount = request.facts.filter((row) => row.accountId !== request.config.accountId || row.platform !== request.config.platform).map((row) => row.sourceRowKey);
  if (wrongAccount.length) issues.push({ code: "ACCOUNT_OR_PLATFORM_MISMATCH", severity: "FATAL", message: "Fact rows contain a different accountId or platform.", sourceRowKeys: wrongAccount });
  const latest = request.facts.reduce<string | null>((max, row) => !max || row.sourceUpdatedAt > max ? row.sourceUpdatedAt : max, null);
  if (latest) {
    const ageHours = (new Date(request.runAt).getTime() - new Date(latest).getTime()) / 3_600_000;
    if (ageHours > request.config.dataFreshnessHours) issues.push({ code: "SOURCE_DATA_STALE", severity: "FATAL", message: `Source data is ${ageHours.toFixed(1)} hours old.` });
  }
  const futureRows = request.facts.filter((row) => row.date > request.asOfDate).map((row) => row.sourceRowKey);
  if (futureRows.length) issues.push({ code: "FUTURE_DATED_ROWS", severity: "WARNING", message: `${futureRows.length} rows are after asOfDate and will be ignored.`, sourceRowKeys: futureRows });
  const scopes = resolvedScopes(request.config);
  for (const scope of scopes) {
    const activeDefinition = request.metricDefinitions.find((item) => item.key === scope.primaryMetricKey);
    if (!activeDefinition) {
      issues.push({ code: `SCOPE_METRIC_UNDEFINED_${scope.scopeId}`, severity: "FATAL", message: `${scope.name}: primary metric ${scope.primaryMetricKey} is undefined.` });
      continue;
    }
    const scopeRules = request.rules.filter((rule) => rule.ruleSetId === scope.ruleSetId && rule.version === scope.ruleVersion);
    if (scopeRules.some((rule) => (rule.minSpendTargetMultiple ?? 0) > 0)
      && !(activeDefinition.kind === "RATIO" && activeDefinition.numerator === "spend" && activeDefinition.direction === "LOWER_IS_BETTER")) {
      issues.push({ code: `TARGET_MULTIPLE_INVALID_${scope.scopeId}`, severity: "FATAL", message: `${scope.name}: target spend multiple is only valid for lower-is-better cost ratios.` });
    }
    const scoredWindows = scope.windows.filter((window) => window.includeInScore && window.weight > 0);
    const windowWeight = scoredWindows.reduce((sum, item) => sum + item.weight, 0);
    if (!scoredWindows.length || Math.abs(windowWeight - 1) > 0.0001) {
      issues.push({ code: `WINDOW_WEIGHTS_NOT_100_${scope.scopeId}`, severity: "FATAL", message: `${scope.name}: scored window weights sum to ${windowWeight}, expected 1.` });
    }
    if (new Set(scope.windows.map((window) => window.id)).size !== scope.windows.length) {
      issues.push({ code: `DUPLICATE_WINDOW_IDS_${scope.scopeId}`, severity: "FATAL", message: `${scope.name}: window IDs must be unique.` });
    }
  }
  const validScopeIds = new Set(scopes.map((scope) => scope.scopeId));
  const brokenClassificationRules = request.config.classificationRules.filter((rule) =>
    rule.outcome === "PFM_INCLUDED" && (!rule.scopeId || !validScopeIds.has(rule.scopeId))
  );
  if (brokenClassificationRules.length) {
    issues.push({ code: "CLASSIFICATION_SCOPE_MISSING", severity: "FATAL", message: `${brokenClassificationRules.length} PFM classification rules point to a missing scope.` });
  }
  const classified = classifyFacts(request.facts.filter((row) => row.date <= request.asOfDate), request.config);
  const included = classified.filter((row) => row.optimizationClass === "PFM_INCLUDED").length;
  const unclassified = classified.filter((row) => row.optimizationClass === "REVIEW_UNCLASSIFIED").length;
  if (!included && classified.length) {
    issues.push({ code: "NO_PFM_ROWS_INCLUDED", severity: "WARNING", message: "No rows are currently routed into an enabled PFM optimization scope." });
  }
  if (unclassified) {
    issues.push({ code: "UNCLASSIFIED_ROWS_REQUIRE_REVIEW", severity: "WARNING", message: `${unclassified} rows do not match a PFM/Non-PFM classification rule.` });
  }
  return { status: issues.some((item) => item.severity === "FATAL") ? "FAIL" : issues.length ? "WARNING" : "PASS", issues, latestSourceUpdateAt: latest };
}

export function filterUsableFacts(facts: FactRow[], asOfDate: string): FactRow[] {
  return facts.filter((row) => row.date <= asOfDate);
}
