import type {
  FactRow,
  MetricDefinition,
  OptimizationRule,
  ProjectConfig
} from "@/core/schemas";
import type { ActionEvent, ActionRecord } from "@/core/actions";
import type { DimensionMapping, SourceMapping, SupportingMetricMapping } from "@/core/normalize";
import type { AiInsight } from "@/ai/contracts";

export type ImportRecord = {
  id: string;
  importedAt: string;
  fileName: string;
  entityLevel: FactRow["entityLevel"];
  accepted: number;
  rejected: number;
  mode: "STRICT" | "PARTIAL";
  errorCodes: string[];
};

export type OptimizationRun = {
  runId: string;
  runAt: string;
  asOfDate?: string;
  status: "COMPLETED" | "BLOCKED";
  qc: {
    status: "PASS" | "WARNING" | "FAIL";
    issues: Array<{ code: string; severity: "FATAL" | "WARNING"; message: string }>;
    latestSourceUpdateAt: string | null;
  };
  evidence: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  actions: ActionRecord[];
};

export type LocalProject = {
  config: ProjectConfig;
  metricDefinitions: MetricDefinition[];
  rules: OptimizationRule[];
  mappings: SourceMapping[];
  metricMappings: SupportingMetricMapping[];
  dimensionMappings: DimensionMapping[];
  facts: FactRow[];
  imports: ImportRecord[];
  runs: OptimizationRun[];
  actions: ActionRecord[];
  actionLog: ActionEvent[];
  createdAt: string;
  updatedAt: string;
};

export type AiProviderDraft = {
  id: string;
  name: string;
  kind: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI";
  baseUrl: string;
  model: string;
};

export type AiAnalysisRecord = {
  id: string;
  projectId: string;
  actionId: string | null;
  createdAt: string;
  providerName: string;
  model: string;
  playbookIds: string[];
  insight: AiInsight;
};

export type WorkspaceState = {
  version: 2;
  operatorName: string;
  activeProjectId: string | null;
  activeView: WorkspaceView;
  projects: LocalProject[];
  providers: AiProviderDraft[];
  selectedPlaybookIds: string[];
  analyses: AiAnalysisRecord[];
};

export type WorkspaceView =
  | "OVERVIEW"
  | "PROJECT_SETUP"
  | "DATA_IMPORT"
  | "RULES"
  | "DECISIONS"
  | "ACTIONS"
  | "AI"
  | "RUNS";

export type ProjectCreateInput = {
  projectName: string;
  platform: string;
  accountId: string;
  currency: string;
  timezone: string;
  startDate: string;
  primaryMetricKey: string;
  optimizationEventLabel: string;
  target: number;
  salesModel: ProjectConfig["salesModel"];
  trackingConfidence: ProjectConfig["trackingConfidence"];
  capiStatus: ProjectConfig["capiStatus"];
};
