import { standardMetricLibrary } from "@/core/library";
import type { OptimizationRule, OptimizationScope, ProjectConfig } from "@/core/schemas";
import type { AiProviderDraft, LocalProject, ProjectCreateInput, WorkspaceState } from "./types";

export const DEFAULT_PROVIDERS: AiProviderDraft[] = [
  {
    id: "openai",
    name: "OpenAI",
    kind: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "OPENAI_COMPATIBLE",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4.1-mini"
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "ANTHROPIC",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "GEMINI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash"
  }
];

export const EMPTY_WORKSPACE: WorkspaceState = {
  version: 2,
  operatorName: "Media Buyer",
  activeProjectId: null,
  activeView: "OVERVIEW",
  projects: [],
  providers: DEFAULT_PROVIDERS,
  selectedPlaybookIds: ["noti-performance-v1", "panasonic-vn-case-v1"],
  analyses: []
};

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || `project-${Date.now()}`;
}

function createRule(input: Omit<OptimizationRule, "ruleSetId" | "version" | "metricKey" | "enabled"> & {
  ruleSetId?: string;
  version?: number;
  metricKey?: string;
  enabled?: boolean;
}, ruleSetId: string, metricKey: string): OptimizationRule {
  return {
    ...input,
    ruleSetId: input.ruleSetId ?? ruleSetId,
    version: input.version ?? 1,
    metricKey: input.metricKey ?? metricKey,
    enabled: input.enabled ?? true
  };
}

export function buildDefaultRules(
  metricKey: string,
  ruleSetId: string,
  windows?: ProjectConfig["windows"]
): OptimizationRule[] {
  const isCostPerResult = ["CPL", "CPA", "CPQL"].includes(metricKey);
  const signalWindowId = windows?.find((window) => window.role === "SIGNAL")?.id
    ?? windows?.[0]?.id
    ?? "TODAY";
  const rules: OptimizationRule[] = [];

  for (const entityLevel of ["CAMPAIGN", "ADSET", "AD"] as const) {
    if (isCostPerResult) {
      rules.push(createRule({
        id: `${entityLevel.toLowerCase()}-no-result-stop`,
        name: "Đã tiêu đủ nhưng chưa có kết quả",
        description: "Chặn lãng phí khi entity đã tiêu vượt ngưỡng KPI nhưng chưa tạo ra result.",
        entityLevel,
        scoreSource: signalWindowId,
        evaluationField: metricKey === "CPQL" ? "QUALIFIED_RESULTS" : "RESULTS",
        evidenceSource: signalWindowId,
        minSpendAbsolute: null,
        minSpendTargetMultiple: 1.5,
        minResults: 0,
        operator: "LTE",
        thresholdFrom: 0,
        thresholdTo: null,
        actionCode: "TURN_OFF",
        actionValue: null,
        priority: 100
      }, ruleSetId, metricKey));
    }

    rules.push(createRule({
      id: `${entityLevel.toLowerCase()}-critical-under-target`,
      name: "Hiệu suất thấp nghiêm trọng",
      description: "Achievement dưới 70% target sau khi đã đủ bằng chứng.",
      entityLevel,
      scoreSource: "GEOMETRIC",
      evaluationField: "ACHIEVEMENT",
      evidenceSource: "ALL_SCORE_WINDOWS",
      minSpendAbsolute: isCostPerResult ? null : 1,
      minSpendTargetMultiple: isCostPerResult ? 2 : null,
      minResults: isCostPerResult ? 1 : 0,
      operator: "LT",
      thresholdFrom: 0.8,
      thresholdTo: null,
      actionCode: "TURN_OFF",
      actionValue: null,
      priority: 90
    }, ruleSetId, metricKey));

    rules.push(createRule({
      id: `${entityLevel.toLowerCase()}-watch`,
      name: "Dưới target, cần can thiệp",
      description: "Achievement từ 70% đến dưới 95%.",
      entityLevel,
      scoreSource: "GEOMETRIC",
      evaluationField: "ACHIEVEMENT",
      evidenceSource: "ALL_SCORE_WINDOWS",
      minSpendAbsolute: isCostPerResult ? null : 1,
      minSpendTargetMultiple: isCostPerResult ? 1 : null,
      minResults: isCostPerResult ? 1 : 0,
      operator: "BETWEEN",
      thresholdFrom: 0.8,
      thresholdTo: 1.0,
      actionCode: entityLevel === "AD" ? "TURN_OFF" : "DECREASE_BUDGET",
      actionValue: entityLevel === "AD" ? null : -0.15,
      priority: 70
    }, ruleSetId, metricKey));

    rules.push(createRule({
      id: `${entityLevel.toLowerCase()}-keep`,
      name: "Đạt target",
      description: "Achievement từ 95% đến dưới 120%.",
      entityLevel,
      scoreSource: "GEOMETRIC",
      evaluationField: "ACHIEVEMENT",
      evidenceSource: "ALL_SCORE_WINDOWS",
      minSpendAbsolute: isCostPerResult ? null : 1,
      minSpendTargetMultiple: isCostPerResult ? 0.5 : null,
      minResults: isCostPerResult ? 1 : 0,
      operator: "BETWEEN",
      thresholdFrom: 1.0,
      thresholdTo: 1.2,
      actionCode: "KEEP",
      actionValue: null,
      priority: 50
    }, ruleSetId, metricKey));

    rules.push(createRule({
      id: `${entityLevel.toLowerCase()}-scale`,
      name: "Vượt target, có thể đầu tư thêm",
      description: "Achievement từ 120% target trở lên và đủ sample.",
      entityLevel,
      scoreSource: "GEOMETRIC",
      evaluationField: "ACHIEVEMENT",
      evidenceSource: "ALL_SCORE_WINDOWS",
      minSpendAbsolute: isCostPerResult ? null : 1,
      minSpendTargetMultiple: isCostPerResult ? 1 : null,
      minResults: isCostPerResult ? 3 : 0,
      operator: "GTE",
      thresholdFrom: 1.2,
      thresholdTo: null,
      actionCode: entityLevel === "AD" ? "KEEP" : "INCREASE_BUDGET",
      actionValue: entityLevel === "AD" ? null : 0.2,
      priority: 60
    }, ruleSetId, metricKey));
  }

  return rules;
}

export function createProject(input: ProjectCreateInput): LocalProject {
  const now = new Date().toISOString();
  const baseId = slugify(input.projectName);
  const projectId = `${baseId}-${Date.now().toString(36).slice(-5)}`;
  const ruleSetId = `${projectId}-rules`;
  const windows: ProjectConfig["windows"] = [
    {
      id: "TODAY", label: "Today", kind: "TODAY", days: null, weight: 0.4,
      required: false, includeInScore: true, role: "SIGNAL", minSpend: 0,
      minResults: 0, redFlagThreshold: 0.8
    },
    {
      id: "D3", label: "3 Days", kind: "ROLLING", days: 3, weight: 0.6,
      required: true, includeInScore: true, role: "CONFIRMATION", minSpend: 0,
      minResults: 1, redFlagThreshold: 0.8
    },
    {
      id: "D7", label: "7 Days", kind: "ROLLING", days: 7, weight: 0,
      required: false, includeInScore: false, role: "BASELINE", minSpend: 0,
      minResults: 1, redFlagThreshold: null
    }
  ];
  const defaultScope: OptimizationScope = {
    scopeId: "default-pfm",
    name: input.optimizationEventLabel || "PFM mặc định",
    enabled: true,
    primaryMetricKey: input.primaryMetricKey,
    optimizationEventLabel: input.optimizationEventLabel,
    planTarget: input.target,
    ruleSetId,
    ruleVersion: 1,
    windows,
    achievementCap: 2,
    scaleMinWindowAchievement: 1,
    contextScaleMinAchievement: 1,
    cohortBenchmark: {
      enabled: true,
      lookbackDays: 14,
      minEntities: 3,
      minResults: 5,
      method: "AGGREGATE",
      manualValue: null
    },
    fallbackClassification: "PFM_INCLUDED"
  };
  const config: ProjectConfig = {
    projectId,
    projectName: input.projectName,
    platform: input.platform,
    accountId: input.accountId,
    timezone: input.timezone,
    currency: input.currency.toUpperCase(),
    startDate: input.startDate,
    primaryMetricKey: input.primaryMetricKey,
    optimizationEventLabel: input.optimizationEventLabel,
    target: input.target,
    salesModel: input.salesModel,
    trackingConfidence: input.trackingConfidence,
    capiStatus: input.capiStatus,
    ruleSetId,
    ruleVersion: 1,
    dataFreshnessHours: 30,
    windows,
    optimizationScopes: [defaultScope],
    classificationRules: [],
    contextWeights: {
      CAMPAIGN: { entity: 0.7, context: 0.3 },
      ADSET: { entity: 0.65, context: 0.35 },
      AD: { entity: 0.65, context: 0.35 }
    },
    maxDailyScalePct: 0.2,
    maxDailyScaleActions: 3,
    deferParentScaleWhenChildAction: true,
    dataSource: { kind: "CSV", autoSyncEnabled: true, syncIntervalMinutes: 60, autoRunAfterSync: true }
  };

  return {
    config,
    metricDefinitions: standardMetricLibrary,
    rules: buildDefaultRules(config.primaryMetricKey, ruleSetId, windows),
    mappings: [],
    metricMappings: [],
    dimensionMappings: [],
    facts: [],
    imports: [],
    runs: [],
    actions: [],
    actionLog: [],
    createdAt: now,
    updatedAt: now
  };
}
