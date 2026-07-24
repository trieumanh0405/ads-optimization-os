import { engineRequestSchema } from "./schemas";
import { runOptimizationEngine } from "./engine";

export function runBacktest(rawBaseRequest: unknown, checkpoints: Array<{ asOfDate: string; runAt: string }>) {
  const base = engineRequestSchema.parse(rawBaseRequest);
  const runs = checkpoints.map((checkpoint) => runOptimizationEngine({
    ...base, asOfDate: checkpoint.asOfDate, runAt: checkpoint.runAt,
    facts: base.facts.filter((row) => row.date <= checkpoint.asOfDate),
    priorActions: []
  }));
  const actionCounts = runs.flatMap((run) => run.recommendations).reduce<Record<string, number>>((counts, item) => {
    counts[item.recommendedAction] = (counts[item.recommendedAction] ?? 0) + 1;
    return counts;
  }, {});
  return {
    checkpoints: checkpoints.length,
    completed: runs.filter((run) => run.status === "COMPLETED").length,
    blocked: runs.filter((run) => run.status === "BLOCKED").length,
    actionCounts,
    runs
  };
}
