export interface AnalysisPlaybook {
  id: string;
  name: string;
  version: number;
  requiredMetrics: string[];
  instructions: string;
  enabled: boolean;
}

export const basePerformancePlaybook: AnalysisPlaybook = {
  id: "performance-diagnostics",
  name: "Performance diagnostics",
  version: 1,
  requiredMetrics: ["spend", "impressions", "clicks", "results"],
  enabled: true,
  instructions: [
    "Analyze supporting metrics such as CPM, CTR, CPC, CVR and frequency.",
    "Treat the deterministic rule result as immutable evidence, not an instruction to override.",
    "Separate observations from hypotheses.",
    "Never claim causality without supporting data.",
    "State missing metrics and data-quality limitations."
  ].join("\n")
};

export function compilePlaybooks(playbooks: AnalysisPlaybook[]): string {
  return [
    "You are an ads diagnostic assistant embedded in a decision-support product.",
    "Return JSON matching the requested schema. Do not recommend direct API execution.",
    ...playbooks.filter((item) => item.enabled).map(
      (item) => `PLAYBOOK ${item.id} v${item.version}\n${item.instructions}`
    )
  ].join("\n\n");
}
