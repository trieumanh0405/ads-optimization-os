import { z } from "zod";
import { assertSupabaseResult, supabaseAdmin } from "../supabase-admin";
import type { AppUser } from "../auth";
import { metricDefinitionSchema, optimizationRuleSchema, projectConfigSchema, type FactRow } from "@/core/schemas";
import { canonicalFieldSchema } from "@/core/normalize";
import type { LocalProject, OptimizationRun, ImportRecord } from "@/product/types";
import type { ActionRecord } from "@/core/actions";
import { classifyFacts } from "@/core/scopes";
import { assertProjectAccess } from "./project-access";

const FACT_PAGE_SIZE = 1_000;
const MAX_FACT_ROWS = 20_000;

export const projectBundleSchema = z.object({
  config: projectConfigSchema,
  metricDefinitions: z.array(metricDefinitionSchema).min(1),
  rules: z.array(optimizationRuleSchema).min(1),
  mappings: z.array(z.object({
    canonicalField: canonicalFieldSchema, sourceColumn: z.string().min(1),
    required: z.boolean(), defaultValue: z.unknown().optional()
  })).default([]),
  metricMappings: z.array(z.object({ metricKey: z.string().min(1), sourceColumn: z.string().min(1) })).default([]),
  dimensionMappings: z.array(z.object({ dimensionKey: z.string().min(1), sourceColumn: z.string().min(1) })).default([])
});
export type ProjectBundle = z.infer<typeof projectBundleSchema>;

export async function readStoredFacts(projectId: string, startDate?: string, endDate?: string): Promise<FactRow[]> {
  const supabase = supabaseAdmin();
  const facts: FactRow[] = [];
  for (let offset = 0; offset < MAX_FACT_ROWS; offset += FACT_PAGE_SIZE) {
    let query = supabase.from("facts").select("data").eq("project_id", projectId).order("date", { ascending: true });
    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);
    const { data, error } = await query.range(offset, offset + FACT_PAGE_SIZE - 1);
    assertSupabaseResult(error);
    const page = (data ?? []).map((row) => row.data as FactRow);
    facts.push(...page);
    if (page.length < FACT_PAGE_SIZE) break;
  }
  return facts;
}

export async function saveProjectBundle(user: AppUser, bundle: ProjectBundle) {
  const parsed = projectBundleSchema.parse(bundle);
  const supabase = supabaseAdmin();
  const { data: existing, error: existingError } = await supabase
    .from("projects").select("project_id, organization_id, rules").eq("project_id", parsed.config.projectId).maybeSingle();
  assertSupabaseResult(existingError);
  if (existing) {
    await assertProjectAccess(parsed.config.projectId, user, "editConfig");
    if (JSON.stringify(existing.rules) !== JSON.stringify(parsed.rules)) {
      await assertProjectAccess(parsed.config.projectId, user, "editRules");
    }
  }
  if (existing && existing.organization_id !== user.organizationId) throw new Error("PROJECT_ID_ALREADY_OWNED");

  const now = new Date().toISOString();
  const { error } = await supabase.from("projects").upsert({
    project_id: parsed.config.projectId, organization_id: user.organizationId,
    config: parsed.config, metric_definitions: parsed.metricDefinitions, rules: parsed.rules,
    mappings: parsed.mappings, metric_mappings: parsed.metricMappings,
    dimension_mappings: parsed.dimensionMappings, updated_at: now, created_by: existing ? undefined : user.uid,
    created_at: existing ? undefined : now
  }, { onConflict: "project_id" });
  assertSupabaseResult(error);
  return parsed;
}

export async function listProjects(user: AppUser) {
  const supabase = supabaseAdmin();
  const { data: projects, error } = await supabase
    .from("projects").select("project_id, config, updated_at, created_by").eq("organization_id", user.organizationId).order("updated_at", { ascending: false });
  assertSupabaseResult(error);
  let visible = projects ?? [];
  if (user.role !== "admin") {
    const { data: memberships, error: membershipError } = await supabase
      .from("project_members").select("project_id").eq("user_id", user.uid);
    assertSupabaseResult(membershipError);
    const allowed = new Set((memberships ?? []).map((item) => item.project_id));
    visible = visible.filter((item) => item.created_by === user.uid || allowed.has(item.project_id));
  }
  return visible.map((project) => {
    const config = project.config as { projectName?: string; primaryMetricKey?: string } | null;
    return { projectId: project.project_id, projectName: config?.projectName, primaryMetricKey: config?.primaryMetricKey, updatedAt: project.updated_at, canDelete: user.role === "admin" || project.created_by === user.uid };
  });
}

export async function deleteStoredProject(projectId: string, user: AppUser) {
  const project = await assertProjectAccess(projectId, user);
  if (user.role !== "admin" && project.created_by !== user.uid) throw new Error("PROJECT_DELETE_FORBIDDEN");
  const { error } = await supabaseAdmin().from("projects").delete().eq("project_id", projectId).eq("organization_id", user.organizationId);
  assertSupabaseResult(error);
}

export async function getProjectBundle(projectId: string, user: AppUser): Promise<ProjectBundle> {
  await assertProjectAccess(projectId, user);
  const { data, error } = await supabaseAdmin().from("projects")
    .select("config, metric_definitions, rules, mappings, metric_mappings, dimension_mappings")
    .eq("project_id", projectId).single();
  assertSupabaseResult(error);
  if (!data) throw new Error("PROJECT_NOT_FOUND");
  return projectBundleSchema.parse({
    config: data.config, metricDefinitions: data.metric_definitions, rules: data.rules, mappings: data.mappings,
    metricMappings: data.metric_mappings ?? [], dimensionMappings: data.dimension_mappings ?? []
  });
}

export async function getStoredProjectWorkspace(projectId: string, user: AppUser): Promise<LocalProject> {
  await assertProjectAccess(projectId, user);
  const supabase = supabaseAdmin();
  const [{ data: project, error: projectError }, bundle, facts, { data: actions, error: actionsError }, { data: actionLog, error: actionLogError }, { data: runs, error: runsError }, { data: imports, error: importsError }] = await Promise.all([
    supabase.from("projects").select("created_at, updated_at").eq("project_id", projectId).single(),
    getProjectBundle(projectId, user),
    readStoredFacts(projectId),
    supabase.from("action_queue").select("data").eq("project_id", projectId).order("run_at", { ascending: false }).limit(1000),
    supabase.from("action_log").select("data").eq("project_id", projectId).order("at", { ascending: false }).limit(5000),
    supabase.from("optimization_runs").select("data").eq("project_id", projectId).order("run_at", { ascending: false }).limit(100),
    supabase.from("import_runs").select("data").eq("project_id", projectId).order("imported_at", { ascending: false }).limit(100)
  ]);
  assertSupabaseResult(projectError); assertSupabaseResult(actionsError);
  assertSupabaseResult(actionLogError); assertSupabaseResult(runsError); assertSupabaseResult(importsError);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  return {
    ...bundle,
    facts: classifyFacts(facts, bundle.config),
    imports: (imports ?? []).map((row) => row.data as ImportRecord),
    runs: (runs ?? []).map((row) => row.data as OptimizationRun),
    actions: (actions ?? []).map((row) => row.data as ActionRecord),
    actionLog: (actionLog ?? []).map((row) => row.data as LocalProject["actionLog"][number]),
    createdAt: project.created_at, updatedAt: project.updated_at
  };
}
