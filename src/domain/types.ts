/**
 * Note: src/core/schemas.ts is the primary source of truth for domain schemas and types.
 * Overlapping types (EntityLevel, ActionCode, OptimizationRule) are imported and re-exported from core/schemas.ts.
 */
import type { EntityLevel, ActionCode, OptimizationRule } from "../core/schemas";

export type { EntityLevel, ActionCode, OptimizationRule };

export type MetricDirection = "lower_is_better" | "higher_is_better";

export interface MetricSnapshot {
  metricKey: string;
  value: number | null;
  target: number;
  spend: number;
  results: number;
  direction: MetricDirection;
  dataFresh: boolean;
}

export interface RuleDecision {
  action: ActionCode;
  adjustmentPct?: number;
  reasonCodes: string[];
  matchedRuleIds: string[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

export interface AiAnalysisRequest {
  projectId: string;
  entityLevel: EntityLevel;
  entityId: string;
  playbookIds: string[];
  providerId: string;
  model: string;
  metrics: Record<string, number | null>;
  deterministicDecision: RuleDecision;
}
