import { z } from "zod";

export const entityLevelSchema = z.enum(["CAMPAIGN", "ADSET", "AD"]);
export const actionCodeSchema = z.enum([
  "PENDING_DATA", "KEEP", "TURN_OFF", "DECREASE_BUDGET",
  "INCREASE_BUDGET", "REVIEW_MANUALLY"
]);

export const factRowSchema = z.object({
  projectId: z.string().min(1),
  platform: z.string().min(1),
  accountId: z.string().min(1),
  date: z.string().date(),
  hour: z.number().int().min(0).max(23).nullable().default(null),
  entityLevel: entityLevelSchema,
  campaignId: z.string().min(1),
  adsetId: z.string().nullable().default(null),
  adId: z.string().nullable().default(null),
  entityName: z.string().min(1),
  status: z.string().default("UNKNOWN"),
  budgetType: z.enum(["CBO", "ABO", "NONE", "UNKNOWN"]).default("UNKNOWN"),
  budget: z.number().nonnegative().nullable().default(null),
  spend: z.number().nonnegative(),
  result: z.number().nonnegative().nullable().default(null),
  qualifiedResult: z.number().nonnegative().nullable().default(null),
  revenue: z.number().nonnegative().nullable().default(null),
  impressions: z.number().nonnegative().nullable().default(null),
  clicks: z.number().nonnegative().nullable().default(null),
  objective: z.string().nullable().default(null),
  optimizationGoal: z.string().nullable().default(null),
  learningStatus: z.string().nullable().default(null),
  postId: z.string().nullable().default(null),
  scopeId: z.string().nullable().optional(),
  optimizationClass: z.enum(["PFM_INCLUDED", "NON_PFM_EXCLUDED", "REVIEW_UNCLASSIFIED"]).optional(),
  classificationReason: z.string().nullable().optional(),
  metrics: z.record(z.number().nullable()).default({}),
  dimensions: z.record(z.string().nullable()).default({}),
  sourceUpdatedAt: z.string().datetime({ offset: true }),
  sourceRowKey: z.string().min(1)
});

export const metricOperandSchema = z.union([
  z.enum(["spend", "result", "qualifiedResult", "revenue", "impressions", "clicks"]),
  z.string().regex(/^metrics\.[A-Za-z0-9_-]+$/, "Custom operands must use metrics.<key>")
]);

export const metricDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["RATIO", "SUM", "RATE"]),
  numerator: metricOperandSchema,
  denominator: metricOperandSchema.nullable(),
  multiplier: z.number().positive().default(1),
  direction: z.enum(["LOWER_IS_BETTER", "HIGHER_IS_BETTER"]),
  nullWhenDenominatorZero: z.boolean().default(true)
});

export const projectDataSourceSchema = z.object({
  kind: z.enum(["CSV", "GOOGLE_SHEETS"]).default("CSV"),
  spreadsheetId: z.string().min(1).optional(),
  sheetName: z.string().min(1).optional(),
  headerRow: z.number().int().min(1).max(100).optional(),
  autoSyncEnabled: z.boolean().default(true),
  syncIntervalMinutes: z.number().int().min(30).max(1440).default(60),
  autoRunAfterSync: z.boolean().default(true),
  lastSyncedAt: z.string().datetime({ offset: true }).optional(),
  lastSyncStatus: z.enum(["SUCCESS", "PARTIAL", "FAILED"]).optional()
});

export const windowConfigSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().min(1).optional(),
  kind: z.enum(["TODAY", "ROLLING", "LIFETIME"]).optional(),
  days: z.number().int().positive().nullable(),
  weight: z.number().min(0).max(1),
  required: z.boolean().default(false),
  includeInScore: z.boolean().default(true),
  role: z.enum(["SIGNAL", "CONFIRMATION", "BASELINE", "DIAGNOSTIC"]).default("CONFIRMATION"),
  minSpend: z.number().nonnegative().default(0),
  minResults: z.number().nonnegative().default(0),
  redFlagThreshold: z.number().positive().nullable().default(null)
});

export const cohortBenchmarkSchema = z.object({
  enabled: z.boolean().default(true),
  lookbackDays: z.number().int().positive().default(14),
  minEntities: z.number().int().positive().default(3),
  minResults: z.number().nonnegative().default(5),
  method: z.enum(["AGGREGATE", "MEDIAN"]).default("MEDIAN"),
  // An entity must not be part of the benchmark it is judged against, otherwise
  // a large spender is compared mostly to itself.
  excludeSelf: z.boolean().default(true),
  manualValue: z.number().positive().nullable().default(null)
});

/**
 * Optional protection against turning off an entity that misses an unrealistic
 * plan target while still being one of the better performers in the account.
 *
 * Disabled by default. When it was unconditional it vetoed almost every
 * decision in accounts whose overall performance sits below plan, which is
 * exactly when decisive action matters most.
 */
export const cohortGuardSchema = z.object({
  enabled: z.boolean().default(false),
  minPlanAchievement: z.number().min(0).default(0.7),
  minCohortAchievement: z.number().min(0).default(1.2)
});

export const optimizationScopeSchema = z.object({
  scopeId: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  primaryMetricKey: z.string().min(1),
  optimizationEventLabel: z.string().min(1).default("Result"),
  planTarget: z.number().positive(),
  ruleSetId: z.string().min(1),
  ruleVersion: z.number().int().positive().default(1),
  windows: z.array(windowConfigSchema).min(1),
  achievementCap: z.number().positive().default(2),
  scaleMinWindowAchievement: z.number().positive().default(1),
  contextScaleMinAchievement: z.number().positive().default(1),
  // How the configured time windows are combined into one entity score.
  // ARITHMETIC reproduces the team's reference spreadsheet (60% x 3 Days +
  // 40% x Today). GEOMETRIC is stricter: a weak window cannot be hidden by a
  // strong one.
  windowBlendMethod: z.enum(["ARITHMETIC", "GEOMETRIC"]).default("ARITHMETIC"),
  // Which aggregate the entity score is blended against in the second layer.
  // PROJECT matches the spreadsheet's "Total" column; PARENT compares an ad to
  // its own ad set, which reacts to the structure the buyer actually controls.
  contextSource: z.enum(["PROJECT", "PARENT"]).default("PROJECT"),
  cohortBenchmark: cohortBenchmarkSchema.default({
    enabled: true, lookbackDays: 14, minEntities: 3, minResults: 5,
    method: "MEDIAN", excludeSelf: true, manualValue: null
  }),
  cohortGuard: cohortGuardSchema.default({
    enabled: false, minPlanAchievement: 0.7, minCohortAchievement: 1.2
  }),
  // Bumped when the scoring defaults change so stored projects are upgraded
  // on read instead of silently keeping superseded behaviour.
  methodologyVersion: z.number().int().positive().default(1),
  fallbackClassification: z.enum(["PFM_INCLUDED", "REVIEW_UNCLASSIFIED"]).default("REVIEW_UNCLASSIFIED")
});

export const classificationRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  field: z.string().min(1),
  operator: z.enum(["EQUALS", "CONTAINS", "IN", "REGEX"]),
  values: z.array(z.string().min(1)).min(1),
  outcome: z.enum(["PFM_INCLUDED", "NON_PFM_EXCLUDED"]),
  scopeId: z.string().nullable().default(null),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true)
});

export const projectConfigSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  platform: z.string().min(1),
  accountId: z.string().min(1),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  startDate: z.string().date(),
  primaryMetricKey: z.string().min(1),
  optimizationEventLabel: z.string().min(1).default("Result"),
  target: z.number().positive(),
  salesModel: z.enum([
    "ONLINE_CHECKOUT", "LANDING_PAGE_OFFLINE_CLOSE", "MESSAGING_OFFLINE_CLOSE",
    "MARKETPLACE", "MIXED", "AWARENESS_ONLY", "OTHER"
  ]).default("OTHER"),
  trackingConfidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).default("UNKNOWN"),
  capiStatus: z.enum(["VERIFIED", "PARTIAL", "NOT_CONFIGURED", "NOT_APPLICABLE", "UNKNOWN"]).default("UNKNOWN"),
  ruleSetId: z.string().min(1),
  ruleVersion: z.number().int().positive(),
  dataFreshnessHours: z.number().positive(),
  windows: z.array(windowConfigSchema).min(1),
  optimizationScopes: z.array(optimizationScopeSchema).default([]),
  classificationRules: z.array(classificationRuleSchema).default([]),
  contextWeights: z.object({
    CAMPAIGN: z.object({ entity: z.number().min(0).max(1), context: z.number().min(0).max(1) }),
    ADSET: z.object({ entity: z.number().min(0).max(1), context: z.number().min(0).max(1) }),
    AD: z.object({ entity: z.number().min(0).max(1), context: z.number().min(0).max(1) })
  }),
  maxDailyScalePct: z.number().min(0).max(1),
  maxDailyScaleActions: z.number().int().nonnegative(),
  deferParentScaleWhenChildAction: z.boolean().default(true),
  dataSource: projectDataSourceSchema.default({ kind: "CSV" })
});

export const optimizationRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  ruleSetId: z.string().min(1),
  version: z.number().int().positive(),
  entityLevel: entityLevelSchema,
  metricKey: z.string().min(1),
  scoreSource: z.string().min(1),
  evaluationField: z.enum([
    "ACHIEVEMENT", "METRIC_VALUE", "SPEND", "RESULTS", "QUALIFIED_RESULTS", "REVENUE"
  ]).default("ACHIEVEMENT"),
  evidenceSource: z.string().min(1).default("SHORT"),
  minSpendAbsolute: z.number().nonnegative().nullable().default(null),
  minSpendTargetMultiple: z.number().nonnegative().nullable().default(null),
  minResults: z.number().nonnegative(),
  operator: z.enum(["LT", "LTE", "GT", "GTE", "BETWEEN"]),
  thresholdFrom: z.number(),
  thresholdTo: z.number().nullable().default(null),
  actionCode: actionCodeSchema,
  actionValue: z.number().min(-1).max(1).nullable().default(null),
  priority: z.number().int(),
  enabled: z.boolean()
});

export const engineRequestSchema = z.object({
  asOfDate: z.string().date(),
  runAt: z.string().datetime({ offset: true }),
  config: projectConfigSchema,
  metricDefinitions: z.array(metricDefinitionSchema).min(1),
  rules: z.array(optimizationRuleSchema).min(1),
  facts: z.array(factRowSchema),
  priorActions: z.array(z.object({
    actionKey: z.string(),
    approvalStatus: z.enum(["PENDING", "DONE", "REJECTED", "DEFERRED"]),
    recommendedAction: actionCodeSchema
  })).default([])
});

export const CURRENT_METHODOLOGY_VERSION = 2;

export type FactRow = z.infer<typeof factRowSchema>;
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
export type ProjectDataSource = z.infer<typeof projectDataSourceSchema>;
export type WindowConfig = z.infer<typeof windowConfigSchema>;
export type OptimizationScope = z.infer<typeof optimizationScopeSchema>;
export type ClassificationRule = z.infer<typeof classificationRuleSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type OptimizationRule = z.infer<typeof optimizationRuleSchema>;
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EntityLevel = z.infer<typeof entityLevelSchema>;
export type ActionCode = z.infer<typeof actionCodeSchema>;
