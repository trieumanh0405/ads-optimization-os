import { assertSupabaseResult, supabaseAdmin } from "../supabase-admin";
import type { AppUser } from "../auth";
import { runOptimizationEngine } from "@/core/engine";
import { assertProjectAccess } from "./project-access";
import { getProjectBundle, readStoredFacts } from "./project-repository";

export async function runStoredProject(input: { projectId: string; user: AppUser; asOfDate: string; runAt: string }) {
  await assertProjectAccess(input.projectId, input.user, "run");
  const bundle = await getProjectBundle(input.projectId, input.user);
  const supabase = supabaseAdmin();
  const [factRows, { data: actionRows, error: actionError }] = await Promise.all([
    readStoredFacts(input.projectId, bundle.config.startDate, input.asOfDate),
    supabase.from("action_queue").select("data").eq("project_id", input.projectId)
  ]);
  assertSupabaseResult(actionError);
  const output = runOptimizationEngine({
    asOfDate: input.asOfDate, runAt: input.runAt, config: bundle.config,
    metricDefinitions: bundle.metricDefinitions, rules: bundle.rules,
    facts: factRows,
    priorActions: (actionRows ?? []).map((row) => row.data)
  });
  const { error: runError } = await supabase.from("optimization_runs").upsert({
    run_id: output.runId, project_id: input.projectId, run_at: output.runAt, status: output.status, data: output
  }, { onConflict: "run_id" });
  assertSupabaseResult(runError);
  if (output.actions.length) {
    const { error: actionWriteError } = await supabase.from("action_queue").upsert(output.actions.map((action) => ({
      action_id: action.id, project_id: input.projectId, action_key: action.actionKey,
      approval_status: action.approvalStatus, run_at: action.runAt, data: action
    })), { onConflict: "project_id,action_key", ignoreDuplicates: true });
    assertSupabaseResult(actionWriteError);
  }
  return output;
}
