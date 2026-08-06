import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSupabaseResult, supabaseAdmin } from "./supabase-admin";
import type { AppUser } from "./auth";
import { metricDefinitionSchema, optimizationRuleSchema, projectConfigSchema, type FactRow } from "@/core/schemas";
import { canonicalFieldSchema, normalizeRows } from "@/core/normalize";
import { runOptimizationEngine } from "@/core/engine";
import { transitionAction, type ActionRecord, type ApprovalStatus } from "@/core/actions";
import type { LocalProject, OptimizationRun, ImportRecord } from "@/product/types";
import { mappingsForGoogleSync, previewGoogleSheet } from "./google-sheets";
import { classifyFacts } from "@/core/scopes";

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

type ProjectCapability = "view" | "import" | "run" | "editConfig" | "editRules" | "reviewActions";

function documentId(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

async function readStoredFacts(projectId: string, startDate?: string, endDate?: string): Promise<FactRow[]> {
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

/**
 * The service-role database client bypasses RLS. This is the mandatory server
 * authorization guard for every project operation; RLS remains a second layer
 * for future direct/realtime browser reads.
 */
export async function assertProjectAccess(projectId: string, user: AppUser, capability: ProjectCapability = "view") {
  const supabase = supabaseAdmin();
  const { data: project, error: projectError } = await supabase
    .from("projects").select("project_id, organization_id, created_by").eq("project_id", projectId).maybeSingle();
  assertSupabaseResult(projectError);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  if (project.organization_id !== user.organizationId) throw new Error("PROJECT_FORBIDDEN");
  if (user.role === "admin" || project.created_by === user.uid) return project;

  const { data: membership, error: membershipError } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId).eq("user_id", user.uid).maybeSingle();
  assertSupabaseResult(membershipError);
  if (!membership) throw new Error("PROJECT_FORBIDDEN");
  // A project assignment grants the whole operating workflow. Keeping this
  // atomic avoids confusing per-button permission matrices for media buyers.
  return project;
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

export async function importProjectRows(input: { projectId: string; user: AppUser; rows: Record<string, unknown>[]; mode: "STRICT" | "PARTIAL"; fileName?: string }) {
  await assertProjectAccess(input.projectId, input.user, "import");
  const bundle = await getProjectBundle(input.projectId, input.user);
  const normalized = normalizeRows(input.rows, {
    projectId: bundle.config.projectId, platform: bundle.config.platform, accountId: bundle.config.accountId,
    mappings: bundle.mappings, metricMappings: bundle.metricMappings, dimensionMappings: bundle.dimensionMappings
  });
  if (input.mode === "STRICT" && normalized.errors.length) return { imported: 0, errors: normalized.errors, status: "REJECTED" as const };
  const facts = classifyFacts(input.mode === "PARTIAL" ? normalized.facts : normalized.facts, bundle.config);
  if (facts.length) {
    const { error } = await supabaseAdmin().from("facts").upsert(facts.map((fact) => ({
      fact_id: documentId(fact.sourceRowKey), project_id: input.projectId, source_row_key: fact.sourceRowKey,
      date: fact.date, entity_level: fact.entityLevel, source_updated_at: fact.sourceUpdatedAt, data: fact
    })), { onConflict: "project_id,source_row_key" });
    assertSupabaseResult(error);
  }
  const importRecord: ImportRecord = {
    id: crypto.randomUUID(), importedAt: new Date().toISOString(), fileName: input.fileName ?? "API import",
    entityLevel: facts[0]?.entityLevel ?? "AD", accepted: facts.length, rejected: normalized.errors.length,
    mode: input.mode, errorCodes: [...new Set(normalized.errors.map((item) => item.code))]
  };
  const { error: importError } = await supabaseAdmin().from("import_runs").insert({
    import_id: importRecord.id, project_id: input.projectId, imported_at: importRecord.importedAt, data: importRecord
  });
  assertSupabaseResult(importError);
  return { imported: facts.length, errors: normalized.errors, importRecord, status: normalized.errors.length ? "PARTIAL" as const : "IMPORTED" as const };
}

/** Stores pre-normalized facts in a bounded request batch for large imports. */
export async function storeNormalizedFacts(input: { projectId: string; user: AppUser; facts: FactRow[] }) {
  await assertProjectAccess(input.projectId, input.user, "import");
  if (input.facts.some((fact) => fact.projectId !== input.projectId)) throw new Error("FACT_PROJECT_MISMATCH");
  if (!input.facts.length) return { stored: 0 };
  const bundle = await getProjectBundle(input.projectId, input.user);
  const classifiedFacts = classifyFacts(input.facts, bundle.config);
  const { error } = await supabaseAdmin().from("facts").upsert(classifiedFacts.map((fact) => ({
    fact_id: documentId(fact.sourceRowKey), project_id: input.projectId, source_row_key: fact.sourceRowKey,
    date: fact.date, entity_level: fact.entityLevel, source_updated_at: fact.sourceUpdatedAt, data: fact
  })), { onConflict: "project_id,source_row_key" });
  assertSupabaseResult(error);
  return { stored: classifiedFacts.length };
}

export async function finalizeProjectImport(input: {
  projectId: string;
  user: AppUser;
  fileName?: string;
  entityLevel: FactRow["entityLevel"];
  accepted: number;
  rejected: number;
  mode: "STRICT" | "PARTIAL";
  errorCodes: string[];
}) {
  await assertProjectAccess(input.projectId, input.user, "import");
  const importRecord: ImportRecord = {
    id: crypto.randomUUID(), importedAt: new Date().toISOString(), fileName: input.fileName ?? "Batch import",
    entityLevel: input.entityLevel, accepted: input.accepted, rejected: input.rejected,
    mode: input.mode, errorCodes: [...new Set(input.errorCodes)]
  };
  const { error } = await supabaseAdmin().from("import_runs").insert({
    import_id: importRecord.id, project_id: input.projectId, imported_at: importRecord.importedAt, data: importRecord
  });
  assertSupabaseResult(error);
  return importRecord;
}

export async function syncGoogleSheetProject(input: { projectId: string; user: AppUser; runAfterSync?: boolean; force?: boolean }) {
  await assertProjectAccess(input.projectId, input.user, "import");
  const bundle = await getProjectBundle(input.projectId, input.user);
  const source = bundle.config.dataSource;
  if (source.kind !== "GOOGLE_SHEETS" || !source.spreadsheetId || !source.sheetName) {
    throw new Error("GOOGLE_SHEETS_SOURCE_NOT_CONFIGURED");
  }
  const lastSyncTime = source.lastSyncedAt ? Date.parse(source.lastSyncedAt) : Number.NaN;
  const minimumInterval = source.syncIntervalMinutes * 60_000;
  if (!input.force && source.lastSyncStatus !== "FAILED" && Number.isFinite(lastSyncTime) && Date.now() - lastSyncTime < minimumInterval) {
    return {
      syncedAt: source.lastSyncedAt!,
      status: source.lastSyncStatus === "PARTIAL" ? "PARTIAL" as const : "SUCCESS" as const,
      accepted: 0,
      rejected: 0,
      latestDataDate: null,
      importRecord: null,
      run: null,
      skipped: true
    };
  }
  const syncedAt = new Date().toISOString();
  try {
    const preview = await previewGoogleSheet({
      spreadsheetInput: source.spreadsheetId,
      sheetName: source.sheetName,
      headerRow: source.headerRow ?? 1
    });
    const syncMappings = mappingsForGoogleSync(bundle.mappings, syncedAt);
    const normalized = normalizeRows(preview.rows, {
      projectId: bundle.config.projectId,
      platform: bundle.config.platform,
      accountId: bundle.config.accountId,
      mappings: syncMappings,
      metricMappings: bundle.metricMappings,
      dimensionMappings: bundle.dimensionMappings
    });
    const classifiedFacts = classifyFacts(normalized.facts, bundle.config);
    for (let index = 0; index < classifiedFacts.length; index += 500) {
      await storeNormalizedFacts({ projectId: input.projectId, user: input.user, facts: classifiedFacts.slice(index, index + 500) });
    }
    const rejected = new Set(normalized.errors.map((item) => item.row)).size;
    const importRecord = await finalizeProjectImport({
      projectId: input.projectId,
      user: input.user,
      fileName: `Google Sheets sync · ${preview.spreadsheetTitle} / ${preview.sheetName}`,
      entityLevel: normalized.facts[0]?.entityLevel ?? "AD",
      accepted: classifiedFacts.length,
      rejected,
      mode: "PARTIAL",
      errorCodes: normalized.errors.map((item) => item.code)
    });
    const nextBundle = {
      ...bundle,
      config: {
        ...bundle.config,
        dataSource: {
          ...source,
          lastSyncedAt: syncedAt,
          lastSyncStatus: rejected ? "PARTIAL" as const : "SUCCESS" as const
        }
      }
    };
    await saveProjectBundle(input.user, nextBundle);
    const latestDataDate = classifiedFacts.reduce<string | null>((latest, fact) => !latest || fact.date > latest ? fact.date : latest, null);
    const shouldRun = input.runAfterSync ?? source.autoRunAfterSync;
    const run = shouldRun && latestDataDate
      ? await runStoredProject({ projectId: input.projectId, user: input.user, asOfDate: latestDataDate, runAt: syncedAt })
      : null;
    return {
      syncedAt,
      status: rejected ? "PARTIAL" as const : "SUCCESS" as const,
      accepted: classifiedFacts.length,
      rejected,
      latestDataDate,
      importRecord,
      run,
      skipped: false
    };
  } catch (error) {
    await saveProjectBundle(input.user, {
      ...bundle,
      config: {
        ...bundle.config,
        dataSource: { ...source, lastSyncedAt: syncedAt, lastSyncStatus: "FAILED" }
      }
    }).catch(() => undefined);
    throw error;
  }
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
