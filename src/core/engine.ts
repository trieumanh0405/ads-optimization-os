import { randomUUID } from "node:crypto";
import { engineRequestSchema, type EngineRequest } from "./schemas";
import { buildEntityEvidence } from "./windows";
import { filterUsableFacts, runDataQualityChecks } from "./qc";
import { applyCrossEntityGuardrails, evaluateEntity } from "./rules";
import { createActionRecords } from "./actions";

export function runOptimizationEngine(rawRequest: unknown) {
  const request: EngineRequest = engineRequestSchema.parse(rawRequest);
  const qc = runDataQualityChecks(request);
  const runId = randomUUID();
  if (qc.status === "FAIL") return {
    runId, runAt: request.runAt, asOfDate: request.asOfDate, status: "BLOCKED" as const,
    qc, evidence: [], recommendations: [], actions: []
  };
  const metric = request.metricDefinitions.find((item) => item.key === request.config.primaryMetricKey)!;
  const evidence = buildEntityEvidence(filterUsableFacts(request.facts, request.asOfDate), request.config, metric, request.asOfDate);
  const recommendations = applyCrossEntityGuardrails(
    evidence.map((entity) => evaluateEntity(entity, evidence, request.rules, request.config, metric)),
    request.config
  );
  const actions = createActionRecords({
    recommendations, runId, runAt: request.runAt, projectId: request.config.projectId,
    ruleSetId: request.config.ruleSetId, ruleVersion: request.config.ruleVersion,
    existing: request.priorActions.map((item) => ({ actionKey: item.actionKey, approvalStatus: item.approvalStatus }))
  });
  return {
    runId, runAt: request.runAt, asOfDate: request.asOfDate, status: "COMPLETED" as const,
    qc, evidence, recommendations, actions
  };
}
