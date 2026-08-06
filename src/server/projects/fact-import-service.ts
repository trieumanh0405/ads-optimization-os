import { createHash } from "node:crypto";
import { assertSupabaseResult, supabaseAdmin } from "../supabase-admin";
import type { AppUser } from "../auth";
import type { FactRow } from "@/core/schemas";
import { normalizeRows } from "@/core/normalize";
import type { ImportRecord } from "@/product/types";
import { classifyFacts } from "@/core/scopes";
import { assertProjectAccess } from "./project-access";
import { getProjectBundle } from "./project-repository";

function documentId(key: string) {
  return createHash("sha256").update(key).digest("hex");
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
