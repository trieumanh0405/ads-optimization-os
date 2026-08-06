import { assertSupabaseResult, supabaseAdmin } from "../supabase-admin";
import type { AppUser } from "../auth";
import { transitionAction, type ActionRecord, type ApprovalStatus } from "@/core/actions";
import { assertProjectAccess } from "./project-access";

export async function updateStoredAction(input: { projectId: string; user: AppUser; actionId: string; to: ApprovalStatus; actor: string; at: string; note: string | null }) {
  await assertProjectAccess(input.projectId, input.user, "reviewActions");
  const supabase = supabaseAdmin();
  const { data: stored, error: readError } = await supabase.from("action_queue").select("data")
    .eq("project_id", input.projectId).eq("action_id", input.actionId).maybeSingle();
  assertSupabaseResult(readError);
  if (!stored) throw new Error("ACTION_NOT_FOUND");
  const result = transitionAction(stored.data as ActionRecord, input.to, input.actor, input.at, input.note);
  const { error: actionError } = await supabase.from("action_queue").update({
    approval_status: result.action.approvalStatus, data: result.action
  }).eq("project_id", input.projectId).eq("action_id", input.actionId);
  assertSupabaseResult(actionError);
  const { error: logError } = await supabase.from("action_log").insert({
    event_id: result.event.id, project_id: input.projectId, action_id: result.event.actionId,
    at: result.event.at, data: result.event
  });
  assertSupabaseResult(logError);
  return result;
}

export async function listStoredActions(projectId: string, user: AppUser, status?: ApprovalStatus) {
  await assertProjectAccess(projectId, user);
  let query = supabaseAdmin().from("action_queue").select("data").eq("project_id", projectId);
  if (status) query = query.eq("approval_status", status);
  const { data, error } = await query.order("run_at", { ascending: false }).limit(500);
  assertSupabaseResult(error);
  return (data ?? []).map((row) => row.data as ActionRecord);
}

export async function listStoredRuns(projectId: string, user: AppUser) {
  await assertProjectAccess(projectId, user);
  const { data, error } = await supabaseAdmin().from("optimization_runs")
    .select("run_id, run_at, status, data").eq("project_id", projectId).order("run_at", { ascending: false }).limit(50);
  assertSupabaseResult(error);
  return (data ?? []).map((row) => {
    const output = row.data as { qc?: unknown; recommendations?: unknown[]; actions?: unknown[] };
    return { runId: row.run_id, runAt: row.run_at, status: row.status, qc: output.qc, recommendationCount: output.recommendations?.length ?? 0, actionCount: output.actions?.length ?? 0 };
  });
}
