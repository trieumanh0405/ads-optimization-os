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
  windows: z.array(z.object({
    id: z.enum(["TODAY", "SHORT", "LONG", "LIFETIME"]),
    days: z.number().int().positive().nullable(),
    weight: z.number().min(0).max(1),
    required: z.boolean().default(false)
  })).min(1),
  contextWeights: z.object({
    CAMPAIGN: z.object({ entity: z.number().min(0).max(1), context: z.number().min(0).max(1) }),
    ADSET: z.object({ entity: z.number().min(0).max(1), context: z.number().min(0).max(1) }),
    AD: z.object({ entity: z.number().min(0).max(1), context: z.number().min(0).max(1) })
  }),
  maxDailyScalePct: z.number().min(0).max(1),
  maxDailyScaleActions: z.number().int().nonnegative(),
  deferParentScaleWhenChildAction: z.boolean().default(true)
});

export const optimizationRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  ruleSetId: z.string().min(1),
  version: z.number().int().positive(),
  entityLevel: entityLevelSchema,
  metricKey: z.string().min(1),
  scoreSource: z.enum(["TODAY", "SHORT", "LONG", "LIFETIME", "WEIGHTED", "CONTEXT_WEIGHTED"]),
  evaluationField: z.enum([
    "ACHIEVEMENT", "METRIC_VALUE", "SPEND", "RESULTS", "QUALIFIED_RESULTS", "REVENUE"
  ]).default("ACHIEVEMENT"),
  evidenceSource: z.enum(["TODAY", "SHORT", "LONG", "LIFETIME", "TODAY_PLUS_SHORT", "TODAY_PLUS_LONG"]).default("SHORT"),
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

export type FactRow = z.infer<typeof factRowSchema>;
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type OptimizationRule = z.infer<typeof optimizationRuleSchema>;
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EntityLevel = z.infer<typeof entityLevelSchema>;
export type ActionCode = z.infer<typeof actionCodeSchema>;
