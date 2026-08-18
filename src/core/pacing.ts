import type { FactRow, MetricDefinition, OptimizationScope, ProjectConfig } from "./schemas";
import { computeMetric, sumFacts, type MetricTotals } from "./metrics";
import { resolvedWindows } from "./scopes";
import { windowBounds } from "./windows";

/**
 * Plan tracking for one optimization scope.
 *
 * The reference spreadsheet states the plan on qualified results while the ad
 * platform only reports raw results, and bridges the two with a single estimate
 * rate. This module reproduces that bridge and then answers the question the
 * spreadsheet's "Scale Progress" and "Est. EOD Lead" cells exist for: given the
 * plan and the time left, how much budget still has to be pushed.
 */

export type EstimateBlock = {
  /** Share of reported results expected to survive qualification. */
  rate: number | null;
  /** Reported results, before qualification. */
  reportedResults: number | null;
  /** Reported result cost. */
  costPerReportedResult: number | null;
  /** Qualified results expected from the reported ones. */
  qualifiedResults: number | null;
  /** Cost per expected qualified result. */
  costPerQualifiedResult: number | null;
};

export type PlanBlock = {
  /** Target cost per qualified result. */
  targetCostPerQualified: number;
  /** Planned volume of qualified results, when configured. */
  targetQualifiedResults: number | null;
  rate: number | null;
  /** Reported result cost that lands the qualified target. */
  targetCostPerReportedResult: number | null;
  /** Reported result volume that lands the qualified target. */
  targetReportedResults: number | null;
};

export type PacingBlock = {
  planStartDate: string;
  planEndDate: string | null;
  totalDays: number | null;
  elapsedDays: number;
  remainingDays: number | null;
  /** Share of the plan period already spent. */
  timeProgress: number | null;
  /** Share of the planned qualified volume already delivered. */
  resultProgress: number | null;
  /**
   * Result progress divided by time progress. Above 1 means the plan is ahead
   * of schedule, below 1 means it is behind.
   */
  paceIndex: number | null;
  qualifiedRemaining: number | null;
  requiredQualifiedPerDay: number | null;
  /** Daily spend needed at the efficiency actually being achieved. */
  requiredDailySpend: number | null;
  /** Daily spend needed if efficiency improved to the plan target. */
  requiredDailySpendAtPlanEfficiency: number | null;
  /** Average daily spend over the trailing complete days. */
  currentDailySpend: number | null;
  /** Extra daily spend needed on top of the current pace. */
  additionalDailySpend: number | null;
  /** Total spend still required to land the plan. */
  remainingBudget: number | null;
};

export type TodayProjection = {
  /** Reported results booked so far today. */
  resultsSoFar: number | null;
  /** Share of the day already elapsed at run time. */
  dayElapsed: number | null;
  /** Reported results expected by end of day. */
  projectedResults: number | null;
  /** Spend expected by end of day. */
  projectedSpend: number | null;
  /** How the projection was produced. */
  basis: "EXTRAPOLATED" | "TRAILING_AVERAGE" | "UNAVAILABLE";
};

export type WindowSummary = {
  id: string;
  label: string;
  start: string;
  endExclusive: string;
  spend: number;
  reportedResults: number | null;
  costPerReportedResult: number | null;
  qualifiedResults: number | null;
  costPerQualifiedResult: number | null;
  achievement: number | null;
};

export type ScopeSummary = {
  scopeId: string;
  scopeName: string;
  metricKey: string;
  optimizationEventLabel: string;
  currency: string;
  spend: number;
  actual: EstimateBlock;
  plan: PlanBlock;
  /** Actual cost per qualified result against the plan target. */
  achievement: number | null;
  pacing: PacingBlock;
  today: TodayProjection;
  windows: WindowSummary[];
  entityCount: number;
};

const MS_PER_DAY = 86_400_000;
const TRAILING_DAYS = 7;
/** Below this share of the day, extrapolating today's numbers is noise. */
const MIN_DAY_ELAPSED_TO_EXTRAPOLATE = 0.25;

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

/**
 * Share of the day already elapsed at run time, in the project's timezone.
 * Falls back to a full day when the timezone is not resolvable.
 */
export function dayElapsedFraction(runAt: string, asOfDate: string, timezone: string): number | null {
  const runDate = new Date(runAt);
  if (Number.isNaN(runDate.getTime())) return null;
  let localDate: string;
  let hours: number;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(runDate);
    const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    localDate = `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
    hours = Number(lookup("hour"));
    minutes = Number(lookup("minute"));
  } catch {
    return null;
  }
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  // A run pointed at an earlier date is looking at a day that already closed.
  if (localDate > asOfDate) return 1;
  if (localDate < asOfDate) return 0;
  return Math.min(1, Math.max(0, (hours * 60 + minutes) / 1440));
}

function estimateBlock(totals: MetricTotals, definition: MetricDefinition, rate: number | null): EstimateBlock {
  const reportedResults = definition.denominator === "qualifiedResult"
    ? totals.qualifiedResult
    : totals.result;
  const costPerReportedResult = computeMetric(totals, definition);
  // Without an estimate rate there is no separate qualification step, so the
  // reported result is the result the plan is about. Pacing needs a volume
  // either way; `rate` tells the UI whether to show the estimate as its own row.
  const qualifiedResults = reportedResults === null
    ? null
    : rate === null ? reportedResults : reportedResults * rate;
  return {
    rate,
    reportedResults,
    costPerReportedResult,
    qualifiedResults,
    costPerQualifiedResult: rate === null
      ? costPerReportedResult
      : costPerReportedResult === null ? null : costPerReportedResult / rate
  };
}

function achievementFor(
  actualCost: number | null,
  target: number,
  direction: MetricDefinition["direction"]
): number | null {
  if (actualCost === null || actualCost <= 0 || target <= 0) return null;
  return direction === "LOWER_IS_BETTER" ? target / actualCost : actualCost / target;
}

export function buildPacing(
  facts: FactRow[],
  config: ProjectConfig,
  scope: OptimizationScope,
  actual: EstimateBlock,
  asOfDate: string
): PacingBlock {
  const planStartDate = config.startDate;
  const planEndDate = config.planEndDate;
  const elapsedDays = Math.max(1, dayDiff(planStartDate, asOfDate) + 1);
  const totalDays = planEndDate ? Math.max(1, dayDiff(planStartDate, planEndDate) + 1) : null;
  const remainingDays = totalDays === null ? null : Math.max(0, dayDiff(asOfDate, planEndDate as string) + 1);
  const timeProgress = totalDays === null ? null : Math.min(1, elapsedDays / totalDays);

  const targetQualified = scope.planTargetResults;
  const deliveredQualified = actual.qualifiedResults;
  const resultProgress = ratio(deliveredQualified, targetQualified);
  const paceIndex = resultProgress === null || timeProgress === null || timeProgress === 0
    ? null
    : resultProgress / timeProgress;

  const qualifiedRemaining = targetQualified === null || deliveredQualified === null
    ? null
    : Math.max(0, targetQualified - deliveredQualified);
  const requiredQualifiedPerDay = qualifiedRemaining === null || remainingDays === null || remainingDays === 0
    ? null
    : qualifiedRemaining / remainingDays;

  const requiredDailySpend = requiredQualifiedPerDay === null || actual.costPerQualifiedResult === null
    ? null
    : requiredQualifiedPerDay * actual.costPerQualifiedResult;
  const requiredDailySpendAtPlanEfficiency = requiredQualifiedPerDay === null
    ? null
    : requiredQualifiedPerDay * scope.planTarget;

  // Trailing average over complete days only, so a partial today does not drag
  // the current pace down.
  const trailingStart = addDays(asOfDate, -TRAILING_DAYS);
  const trailingFacts = facts.filter((fact) => fact.date >= trailingStart && fact.date < asOfDate);
  const trailingDays = new Set(trailingFacts.map((fact) => fact.date)).size;
  const currentDailySpend = trailingDays === 0
    ? null
    : trailingFacts.reduce((sum, fact) => sum + fact.spend, 0) / trailingDays;

  return {
    planStartDate,
    planEndDate,
    totalDays,
    elapsedDays,
    remainingDays,
    timeProgress,
    resultProgress,
    paceIndex,
    qualifiedRemaining,
    requiredQualifiedPerDay,
    requiredDailySpend,
    requiredDailySpendAtPlanEfficiency,
    currentDailySpend,
    additionalDailySpend: requiredDailySpend === null || currentDailySpend === null
      ? null
      : requiredDailySpend - currentDailySpend,
    remainingBudget: requiredDailySpend === null || remainingDays === null
      ? null
      : requiredDailySpend * remainingDays
  };
}

/**
 * Project where today lands.
 *
 * Delivery is not uniform across the day, so a straight extrapolation is only
 * offered once enough of the day has passed. Before that the trailing daily
 * average is the more honest answer, and the basis is reported either way.
 */
export function projectToday(
  facts: FactRow[],
  definition: MetricDefinition,
  asOfDate: string,
  runAt: string,
  timezone: string
): TodayProjection {
  const todayFacts = facts.filter((fact) => fact.date === asOfDate);
  const todayTotals = sumFacts(todayFacts);
  const resultsSoFar = definition.denominator === "qualifiedResult"
    ? todayTotals.qualifiedResult
    : todayTotals.result;
  const dayElapsed = dayElapsedFraction(runAt, asOfDate, timezone);

  const trailingStart = addDays(asOfDate, -TRAILING_DAYS);
  const trailingFacts = facts.filter((fact) => fact.date >= trailingStart && fact.date < asOfDate);
  const trailingDays = new Set(trailingFacts.map((fact) => fact.date)).size;
  const trailingTotals = sumFacts(trailingFacts);
  const trailingResults = definition.denominator === "qualifiedResult"
    ? trailingTotals.qualifiedResult
    : trailingTotals.result;
  const averageResults = trailingDays === 0 || trailingResults === null ? null : trailingResults / trailingDays;
  const averageSpend = trailingDays === 0 ? null : trailingTotals.spend / trailingDays;

  if (dayElapsed !== null && dayElapsed >= MIN_DAY_ELAPSED_TO_EXTRAPOLATE && resultsSoFar !== null) {
    return {
      resultsSoFar,
      dayElapsed,
      projectedResults: resultsSoFar / dayElapsed,
      projectedSpend: todayTotals.spend / dayElapsed,
      basis: "EXTRAPOLATED"
    };
  }
  if (averageResults !== null) {
    return {
      resultsSoFar,
      dayElapsed,
      projectedResults: averageResults,
      projectedSpend: averageSpend,
      basis: "TRAILING_AVERAGE"
    };
  }
  return { resultsSoFar, dayElapsed, projectedResults: null, projectedSpend: null, basis: "UNAVAILABLE" };
}

export function buildScopeSummary(input: {
  facts: FactRow[];
  config: ProjectConfig;
  scope: OptimizationScope;
  definition: MetricDefinition;
  asOfDate: string;
  runAt: string;
  entityCount: number;
}): ScopeSummary {
  const { facts, config, scope, definition, asOfDate, runAt, entityCount } = input;
  const rate = scope.estimateRate;
  const lifetimeTotals = sumFacts(facts);
  const actual = estimateBlock(lifetimeTotals, definition, rate);

  const plan: PlanBlock = {
    targetCostPerQualified: scope.planTarget,
    targetQualifiedResults: scope.planTargetResults,
    rate,
    targetCostPerReportedResult: rate === null ? scope.planTarget : scope.planTarget * rate,
    targetReportedResults: rate === null || scope.planTargetResults === null
      ? scope.planTargetResults
      : scope.planTargetResults / rate
  };

  const windows: WindowSummary[] = resolvedWindows(scope.windows).map((window) => {
    const bounds = windowBounds(window, asOfDate, config.startDate);
    const selected = facts.filter((fact) => fact.date >= bounds.start && fact.date < bounds.endExclusive);
    const totals = sumFacts(selected);
    const block = estimateBlock(totals, definition, rate);
    return {
      id: window.id,
      label: window.label ?? window.id,
      start: bounds.start,
      endExclusive: bounds.endExclusive,
      spend: totals.spend,
      reportedResults: block.reportedResults,
      costPerReportedResult: selected.length ? block.costPerReportedResult : null,
      qualifiedResults: block.qualifiedResults,
      costPerQualifiedResult: selected.length ? block.costPerQualifiedResult : null,
      achievement: selected.length
        ? achievementFor(block.costPerQualifiedResult, scope.planTarget, definition.direction)
        : null
    };
  });

  return {
    scopeId: scope.scopeId,
    scopeName: scope.name,
    metricKey: scope.primaryMetricKey,
    optimizationEventLabel: scope.optimizationEventLabel,
    currency: config.currency,
    spend: lifetimeTotals.spend,
    actual,
    plan,
    achievement: achievementFor(actual.costPerQualifiedResult, scope.planTarget, definition.direction),
    pacing: buildPacing(facts, config, scope, actual, asOfDate),
    today: projectToday(facts, definition, asOfDate, runAt, config.timezone),
    windows,
    entityCount
  };
}
