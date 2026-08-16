import { createHash, randomUUID } from "node:crypto";
import type { ActionCode } from "./schemas";
import type { Recommendation } from "./rules";

export type ApprovalStatus = "PENDING" | "DONE" | "REJECTED" | "DEFERRED";
export type ActionRecord = {
  id: string; actionKey: string; runId: string; runAt: string; projectId: string;
  scopeId: string; scopeName: string;
  entityLevel: string; entityId: string; entityName: string; currentStatus: string;
  recommendedAction: ActionCode; adjustmentPct: number | null; reasonCodes: string[];
  matchedRuleIds: string[]; evidenceWindow: string; currentMetric: number | null;
  evaluatedValue: number | null;
  targetMetric: number; confidence: number; executionPhase: number;
  approvalStatus: ApprovalStatus; reviewer: string | null; executedAt: string | null; note: string | null;
  ruleSetId: string; ruleVersion: number; evidenceHash: string;
};
export type ActionEvent = { id: string; actionId: string; at: string; actor: string; from: ApprovalStatus; to: ApprovalStatus; note: string | null };

function roundNumericValues<T>(obj: T): T {
  if (typeof obj === "number") {
    return Number.isFinite(obj) ? (Math.round(obj * 10000) / 10000 as unknown as T) : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => roundNumericValues(item)) as unknown as T;
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = roundNumericValues(value);
    }
    return result as T;
  }
  return obj;
}

export function evidenceHash(recommendation: Recommendation): string {
  const payload = roundNumericValues({
    scopeId: recommendation.scopeId, entityId: recommendation.entityId, action: recommendation.recommendedAction,
    currentMetric: recommendation.currentMetric, score: recommendation.weightedAchievement,
    contextScore: recommendation.contextWeightedAchievement,
    cohortScore: recommendation.cohortWeightedAchievement,
    rules: recommendation.matchedRuleIds, reasons: recommendation.reasonCodes
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createActionRecords(input: {
  recommendations: Recommendation[]; runId: string; runAt: string; projectId: string;
  existing: Array<Pick<ActionRecord, "actionKey" | "approvalStatus">>;
}): ActionRecord[] {
  const seenKeys = new Set(input.existing.map((item) => item.actionKey));
  const activeKeys = input.existing
    .filter((item) => item.approvalStatus === "PENDING" || item.approvalStatus === "DEFERRED")
    .map((item) => item.actionKey);
  return input.recommendations
    .filter((item) => item.recommendedAction !== "PENDING_DATA" && item.recommendedAction !== "KEEP")
    .flatMap((item) => {
    const hash = evidenceHash(item);
    // One open action per entity + recommendation. Legacy keys ended with an
    // evidence hash, so prefix matching also stops old queues growing forever.
    const actionPrefix = `${input.projectId}|${item.scopeId}|${item.entityLevel}|${item.entityId}|${item.recommendedAction}`;
    const actionKey = `${actionPrefix}|${hash.slice(0, 16)}`;
    if (seenKeys.has(actionKey) || activeKeys.some((key) => key === actionPrefix || key.startsWith(`${actionPrefix}|`))) return [];
    return [{
      id: randomUUID(), actionKey, runId: input.runId, runAt: input.runAt, projectId: input.projectId,
      scopeId: item.scopeId, scopeName: item.scopeName,
      entityLevel: item.entityLevel, entityId: item.entityId, entityName: item.entityName, currentStatus: item.currentStatus,
      recommendedAction: item.recommendedAction, adjustmentPct: item.adjustmentPct, reasonCodes: item.reasonCodes,
      matchedRuleIds: item.matchedRuleIds, evidenceWindow: item.evidenceWindow, currentMetric: item.currentMetric,
      evaluatedValue: item.evaluatedValue,
      targetMetric: item.targetMetric, confidence: item.confidence, executionPhase: item.executionPhase,
      approvalStatus: "PENDING" as const, reviewer: null, executedAt: null, note: null,
      ruleSetId: item.ruleSetId, ruleVersion: item.ruleVersion, evidenceHash: hash
    }];
    });
}

const transitions: Record<ApprovalStatus, ApprovalStatus[]> = {
  PENDING: ["DONE", "REJECTED", "DEFERRED"],
  DEFERRED: ["PENDING", "DONE", "REJECTED"],
  DONE: [], REJECTED: []
};

export function transitionAction(action: ActionRecord, to: ApprovalStatus, actor: string, at: string, note: string | null): { action: ActionRecord; event: ActionEvent } {
  if (!transitions[action.approvalStatus].includes(to)) throw new Error(`Invalid action transition ${action.approvalStatus} -> ${to}`);
  const from = action.approvalStatus;
  return {
    action: { ...action, approvalStatus: to, reviewer: actor, executedAt: to === "DONE" ? at : action.executedAt, note },
    event: { id: randomUUID(), actionId: action.id, at, actor, from, to, note }
  };
}
