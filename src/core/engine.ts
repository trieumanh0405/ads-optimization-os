import { randomUUID } from "node:crypto";
import { engineRequestSchema, type EngineRequest } from "./schemas";
import { attachCohortEvidence, buildEntityEvidence, computeCohortBenchmark } from "./windows";
import type { EntityEvidence } from "./windows";
import { filterUsableFacts, runDataQualityChecks } from "./qc";
import { applyCrossEntityGuardrails, evaluateEntity } from "./rules";
import type { Recommendation } from "./rules";
import { createActionRecords } from "./actions";
import { classifyFacts, factsForScope, projectConfigForScope, resolvedScopes } from "./scopes";

export function runOptimizationEngine(rawRequest: unknown) {
  const request: EngineRequest = engineRequestSchema.parse(rawRequest);
  const qc = runDataQualityChecks(request);
  const runId = randomUUID();
  if (qc.status === "FAIL") return {
    runId, runAt: request.runAt, asOfDate: request.asOfDate, status: "BLOCKED" as const,
    qc, evidence: [], recommendations: [], actions: [],
    classificationSummary: { pfmIncluded: 0, nonPfmExcluded: 0, reviewUnclassified: 0 }
  };
  const usableFacts = classifyFacts(filterUsableFacts(request.facts, request.asOfDate), request.config);
  const allEvidence: EntityEvidence[] = [];
  const allRecommendations: Recommendation[] = [];
  for (const scope of resolvedScopes(request.config)) {
    const metric = request.metricDefinitions.find((item) => item.key === scope.primaryMetricKey);
    if (!metric) continue;
    const scopedFacts = factsForScope(usableFacts, scope.scopeId);
    if (!scopedFacts.length) continue;
    const scopedConfig = projectConfigForScope(request.config, scope);
    const planEvidence = buildEntityEvidence(scopedFacts, scopedConfig, metric, request.asOfDate, scope);
    const cohortBenchmark = computeCohortBenchmark(scopedFacts, scopedConfig, scope, metric, request.asOfDate);
    const cohortEvidence = cohortBenchmark === null ? [] : buildEntityEvidence(
      scopedFacts,
      scopedConfig,
      metric,
      request.asOfDate,
      { ...scope, planTarget: cohortBenchmark }
    );
    const evidence = attachCohortEvidence(planEvidence, cohortEvidence, cohortBenchmark);
    const recommendations = applyCrossEntityGuardrails(
      evidence.map((entity) => evaluateEntity(entity, evidence, request.rules, scopedConfig, metric, scope)),
      scopedConfig
    );
    allEvidence.push(...evidence);
    allRecommendations.push(...recommendations);
  }
  const evidence = allEvidence;
  const recommendations = allRecommendations;
  const actions = createActionRecords({
    recommendations, runId, runAt: request.runAt, projectId: request.config.projectId,
    existing: request.priorActions.map((item) => ({ actionKey: item.actionKey, approvalStatus: item.approvalStatus }))
  });
  const classificationSummary = {
    pfmIncluded: usableFacts.filter((fact) => fact.optimizationClass === "PFM_INCLUDED").length,
    nonPfmExcluded: usableFacts.filter((fact) => fact.optimizationClass === "NON_PFM_EXCLUDED").length,
    reviewUnclassified: usableFacts.filter((fact) => fact.optimizationClass === "REVIEW_UNCLASSIFIED").length
  };
  return {
    runId, runAt: request.runAt, asOfDate: request.asOfDate, status: "COMPLETED" as const,
    qc, evidence, recommendations, actions, classificationSummary
  };
}
