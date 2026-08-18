import { CURRENT_METHODOLOGY_VERSION } from "./schemas";
import type {
  ClassificationRule,
  FactRow,
  OptimizationScope,
  ProjectConfig,
  WindowConfig
} from "./schemas";

function inferredWindow(window: WindowConfig): WindowConfig {
  const upper = window.id.toUpperCase();
  const kind = window.kind ?? (upper === "TODAY" ? "TODAY" : upper === "LIFETIME" ? "LIFETIME" : "ROLLING");
  const role = window.role ?? (kind === "TODAY" ? "SIGNAL" : kind === "LIFETIME" ? "DIAGNOSTIC" : "CONFIRMATION");
  return {
    ...window,
    kind,
    label: window.label ?? (kind === "TODAY" ? "Today" : kind === "LIFETIME" ? "Lifetime" : `${window.days ?? ""} Days`.trim()),
    role,
    includeInScore: window.includeInScore ?? window.weight > 0,
    minSpend: window.minSpend ?? 0,
    minResults: window.minResults ?? 0,
    redFlagThreshold: window.redFlagThreshold ?? null
  };
}

export function resolvedWindows(windows: WindowConfig[]): WindowConfig[] {
  return windows.map(inferredWindow);
}

/**
 * Upgrade a stored scope to the current scoring methodology.
 *
 * Version 1 scopes benchmarked every entity against the aggregate of the whole
 * account, including the entity itself, which inflated the benchmark and made
 * the cohort comparison unreadable. They also flagged a partial Today window as
 * a red flag, which fires on almost every entity before the day is over.
 */
export function upgradeScope(scope: OptimizationScope): OptimizationScope {
  if (scope.methodologyVersion >= CURRENT_METHODOLOGY_VERSION) return scope;
  return {
    ...scope,
    methodologyVersion: CURRENT_METHODOLOGY_VERSION,
    cohortBenchmark: { ...scope.cohortBenchmark, method: "MEDIAN", excludeSelf: true },
    windows: scope.windows.map((window) => (
      (window.kind ?? window.id.toUpperCase()) === "TODAY"
        ? { ...window, redFlagThreshold: null }
        : window
    ))
  };
}

export function legacyScope(config: ProjectConfig): OptimizationScope {
  return {
    scopeId: "default-pfm",
    name: config.optimizationEventLabel || "PFM mặc định",
    enabled: true,
    primaryMetricKey: config.primaryMetricKey,
    optimizationEventLabel: config.optimizationEventLabel,
    planTarget: config.target,
    ruleSetId: config.ruleSetId,
    ruleVersion: config.ruleVersion,
    windows: resolvedWindows(config.windows),
    achievementCap: 2,
    scaleMinWindowAchievement: 1,
    contextScaleMinAchievement: 1,
    windowBlendMethod: "ARITHMETIC",
    contextSource: "PROJECT",
    cohortBenchmark: {
      enabled: true,
      lookbackDays: 14,
      minEntities: 3,
      minResults: 5,
      method: "MEDIAN",
      excludeSelf: true,
      manualValue: null
    },
    cohortGuard: { enabled: false, minPlanAchievement: 0.7, minCohortAchievement: 1.2 },
    methodologyVersion: CURRENT_METHODOLOGY_VERSION,
    // Existing projects keep operating until an admin creates classification
    // rules. Once rules exist, unmatched rows are sent to review.
    fallbackClassification: config.classificationRules.length ? "REVIEW_UNCLASSIFIED" : "PFM_INCLUDED"
  };
}

export function resolvedScopes(config: ProjectConfig): OptimizationScope[] {
  const scopes = config.optimizationScopes.length ? config.optimizationScopes : [legacyScope(config)];
  return scopes.filter((scope) => scope.enabled).map((scope) => {
    const upgraded = upgradeScope(scope);
    return { ...upgraded, windows: resolvedWindows(upgraded.windows) };
  });
}

export function projectConfigForScope(config: ProjectConfig, scope: OptimizationScope): ProjectConfig {
  return {
    ...config,
    primaryMetricKey: scope.primaryMetricKey,
    optimizationEventLabel: scope.optimizationEventLabel,
    target: scope.planTarget,
    ruleSetId: scope.ruleSetId,
    ruleVersion: scope.ruleVersion,
    windows: resolvedWindows(scope.windows)
  };
}

function normalized(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function fieldValue(fact: FactRow, field: string): string {
  if (field.startsWith("dimensions.")) return normalized(fact.dimensions[field.slice("dimensions.".length)]);
  if (Object.hasOwn(fact, field)) return normalized((fact as unknown as Record<string, unknown>)[field]);
  return normalized(fact.dimensions[field]);
}

function ruleMatches(fact: FactRow, rule: ClassificationRule): boolean {
  const actual = fieldValue(fact, rule.field);
  if (!actual) return false;
  const values = rule.values.map(normalized);
  if (rule.operator === "EQUALS" || rule.operator === "IN") return values.includes(actual);
  if (rule.operator === "CONTAINS") return values.some((value) => actual.includes(value));
  try {
    return values.some((value) => new RegExp(value, "i").test(actual));
  } catch {
    return false;
  }
}

export function classifyFact(
  fact: FactRow,
  config: ProjectConfig,
  scopes = resolvedScopes(config),
  sortedRules?: ClassificationRule[],
  scopeIds?: Set<string>,
  fallback?: OptimizationScope
): FactRow {
  const activeScopeIds = scopeIds ?? new Set(scopes.map((scope) => scope.scopeId));
  const activeRules = sortedRules ?? [...config.classificationRules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority);

  const match = activeRules.find((rule) => ruleMatches(fact, rule));

  if (match) {
    if (match.outcome === "NON_PFM_EXCLUDED") {
      return {
        ...fact,
        scopeId: null,
        optimizationClass: "NON_PFM_EXCLUDED",
        classificationReason: `RULE:${match.id}`
      };
    }
    if (match.scopeId && activeScopeIds.has(match.scopeId)) {
      return {
        ...fact,
        scopeId: match.scopeId,
        optimizationClass: "PFM_INCLUDED",
        classificationReason: `RULE:${match.id}`
      };
    }
    return {
      ...fact,
      scopeId: null,
      optimizationClass: "REVIEW_UNCLASSIFIED",
      classificationReason: `RULE_SCOPE_MISSING:${match.id}`
    };
  }

  const activeFallback = fallback !== undefined
    ? fallback
    : scopes.find((scope) => scope.fallbackClassification === "PFM_INCLUDED");

  if (activeFallback) {
    return {
      ...fact,
      scopeId: activeFallback.scopeId,
      optimizationClass: "PFM_INCLUDED",
      classificationReason: config.classificationRules.length ? "FALLBACK_SCOPE" : "LEGACY_DEFAULT_SCOPE"
    };
  }
  return {
    ...fact,
    scopeId: null,
    optimizationClass: "REVIEW_UNCLASSIFIED",
    classificationReason: "NO_CLASSIFICATION_RULE_MATCH"
  };
}

export function classifyFacts(facts: FactRow[], config: ProjectConfig): FactRow[] {
  const scopes = resolvedScopes(config);
  const sortedRules = [...config.classificationRules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority);
  const scopeIds = new Set(scopes.map((scope) => scope.scopeId));
  const fallback = scopes.find((scope) => scope.fallbackClassification === "PFM_INCLUDED");
  return facts.map((fact) => classifyFact(fact, config, scopes, sortedRules, scopeIds, fallback));
}

export function factsForScope(facts: FactRow[], scopeId: string): FactRow[] {
  return facts.filter((fact) => fact.optimizationClass === "PFM_INCLUDED" && fact.scopeId === scopeId);
}

