export type EntityLevel = "campaign" | "adset" | "ad";
export type MetricDirection = "lower_is_better" | "higher_is_better";
export type ActionCode =
  | "PENDING_DATA"
  | "KEEP"
  | "TURN_OFF"
  | "DECREASE_BUDGET"
  | "INCREASE_BUDGET"
  | "REVIEW_MANUALLY";

export interface MetricSnapshot {
  metricKey: string;
  value: number | null;
  target: number;
  spend: number;
  results: number;
  direction: MetricDirection;
  dataFresh: boolean;
}

export interface OptimizationRule {
  id: string;
  version: number;
  entityLevel: EntityLevel;
  metricKey: string;
  minSpend: number;
  minResults: number;
  operator: "lt" | "lte" | "gt" | "gte" | "between";
  thresholdFrom: number;
  thresholdTo?: number;
  action: ActionCode;
  adjustmentPct?: number;
  priority: number;
  enabled: boolean;
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
