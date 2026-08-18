import type { ActionRecord } from "@/core/actions";
import type { LocalProject, OptimizationRun } from "@/product/types";

/** Shape of a recommendation as it comes back from a stored engine run. */
export type RecommendationView = {
  scopeId: string;
  scopeName: string;
  entityLevel: "CAMPAIGN" | "ADSET" | "AD";
  entityId: string;
  entityName: string;
  currentStatus: string;
  budgetType: string;
  recommendedAction: ActionRecord["recommendedAction"];
  adjustmentPct: number | null;
  reasonCodes: string[];
  matchedRuleIds: string[];
  evidenceWindow: string;
  currentMetric: number | null;
  targetMetric: number;
  weightedAchievement: number | null;
  blendedAchievement?: number | null;
  contextWeightedAchievement: number | null;
  cohortWeightedAchievement: number | null;
  cohortBenchmark: number | null;
  cohortRank?: number | null;
  cohortSize?: number | null;
  minimumWindowAchievement: number | null;
  trendRatio: number | null;
  redFlagWindowIds: string[];
  evaluatedValue: number | null;
  confidence: number;
  executionPhase: number;
  windowMetrics?: Array<{
    id: string;
    label: string;
    role: string;
    includeInScore: boolean;
    start: string;
    endExclusive: string;
    value: number | null;
    achievement: number | null;
    spend: number;
    result: number | null;
    rowCount: number;
  }>;
};

export type SourceSyncResponse = {
  sync: {
    syncedAt: string;
    status: "SUCCESS" | "PARTIAL";
    accepted: number;
    rejected: number;
    latestDataDate: string | null;
    run: OptimizationRun | null;
    skipped?: boolean;
  };
  project: LocalProject;
};
