import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSupabaseResult, supabaseAdmin } from "./supabase-admin";

export const playbookInputSchema = z.object({
  name: z.string().min(1), version: z.number().int().positive(), projectTypes: z.array(z.string()).default([]),
  requiredMetrics: z.array(z.string()).min(1), optionalMetrics: z.array(z.string()).default([]),
  instructions: z.string().min(20), prohibitedActions: z.array(z.string()).default(["override_rule_action", "execute_meta_action"]),
  enabled: z.boolean().default(true)
});
export type PlaybookRecord = z.infer<typeof playbookInputSchema> & { id: string; createdAt: string; updatedAt: string };

export async function savePlaybook(organizationId: string, input: z.infer<typeof playbookInputSchema>): Promise<PlaybookRecord> {
  const id = randomUUID(); const now = new Date().toISOString();
  const record = { id, ...input, createdAt: now, updatedAt: now };
  const { error } = await supabaseAdmin().from("analysis_playbooks").insert({
    playbook_id: id, organization_id: organizationId, name: input.name, version: input.version,
    project_types: input.projectTypes, required_metrics: input.requiredMetrics,
    optional_metrics: input.optionalMetrics, instructions: input.instructions,
    prohibited_actions: input.prohibitedActions, enabled: input.enabled,
    created_at: now, updated_at: now
  });
  assertSupabaseResult(error);
  return record;
}

export async function listPlaybooks(organizationId: string): Promise<PlaybookRecord[]> {
  const { data, error } = await supabaseAdmin().from("analysis_playbooks")
    .select("playbook_id, name, version, project_types, required_metrics, optional_metrics, instructions, prohibited_actions, enabled, created_at, updated_at")
    .eq("organization_id", organizationId).eq("enabled", true).order("name");
  assertSupabaseResult(error);
  return (data ?? []).map((playbook) => ({
    id: playbook.playbook_id, name: playbook.name, version: playbook.version,
    projectTypes: playbook.project_types, requiredMetrics: playbook.required_metrics,
    optionalMetrics: playbook.optional_metrics, instructions: playbook.instructions,
    prohibitedActions: playbook.prohibited_actions, enabled: playbook.enabled,
    createdAt: playbook.created_at, updatedAt: playbook.updated_at
  }));
}

export async function getPlaybooks(organizationId: string, ids: string[]): Promise<PlaybookRecord[]> {
  const all = await listPlaybooks(organizationId);
  const selected = all.filter((item) => ids.includes(item.id));
  if (selected.length !== new Set(ids).size) throw new Error("ANALYSIS_PLAYBOOK_NOT_FOUND");
  return selected;
}
