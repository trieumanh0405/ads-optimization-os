import { createHash } from "node:crypto";
import { z } from "zod";
import { adminDb } from "./firebase-admin";
import { metricDefinitionSchema, optimizationRuleSchema, projectConfigSchema, type FactRow } from "@/core/schemas";
import { canonicalFieldSchema, normalizeRows } from "@/core/normalize";
import { runOptimizationEngine } from "@/core/engine";
import { transitionAction, type ActionRecord, type ApprovalStatus } from "@/core/actions";

export const projectBundleSchema = z.object({
  config: projectConfigSchema,
  metricDefinitions: z.array(metricDefinitionSchema).min(1),
  rules: z.array(optimizationRuleSchema).min(1),
  mappings: z.array(z.object({
    canonicalField: canonicalFieldSchema, sourceColumn: z.string().min(1),
    required: z.boolean(), defaultValue: z.unknown().optional()
  })).min(1)
});
export type ProjectBundle = z.infer<typeof projectBundleSchema>;

const projectRef = (projectId: string) => adminDb().collection("projects").doc(projectId);
const firestoreSafe = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function assertProjectAccess(projectId: string, organizationId: string) {
  const snapshot = await projectRef(projectId).get();
  if (!snapshot.exists) throw new Error("PROJECT_NOT_FOUND");
  if (snapshot.get("organizationId") !== organizationId) throw new Error("PROJECT_FORBIDDEN");
  return snapshot;
}

export async function saveProjectBundle(organizationId: string, bundle: ProjectBundle) {
  const parsed = projectBundleSchema.parse(bundle);
  const now = new Date().toISOString();
  const existing = await projectRef(parsed.config.projectId).get();
  if (existing.exists && existing.get("organizationId") !== organizationId) throw new Error("PROJECT_ID_ALREADY_OWNED");
  await projectRef(parsed.config.projectId).set(firestoreSafe({
    organizationId, config: parsed.config, metricDefinitions: parsed.metricDefinitions,
    rules: parsed.rules, mappings: parsed.mappings, updatedAt: now,
    createdAt: existing.exists ? existing.get("createdAt") ?? now : now
  }), { merge: true });
  return parsed;
}

export async function listProjects(organizationId: string) {
  const snapshot = await adminDb().collection("projects").where("organizationId", "==", organizationId).get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return { projectId: document.id, projectName: data.config?.projectName, primaryMetricKey: data.config?.primaryMetricKey, updatedAt: data.updatedAt };
  });
}

export async function getProjectBundle(projectId: string, organizationId: string): Promise<ProjectBundle> {
  const snapshot = await assertProjectAccess(projectId, organizationId);
  return projectBundleSchema.parse(snapshot.data());
}

function documentId(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export async function importProjectRows(input: {
  projectId: string; organizationId: string; rows: Record<string, unknown>[]; mode: "STRICT" | "PARTIAL";
}) {
  const bundle = await getProjectBundle(input.projectId, input.organizationId);
  const normalized = normalizeRows(input.rows, {
    projectId: bundle.config.projectId, platform: bundle.config.platform,
    accountId: bundle.config.accountId,
    mappings: bundle.mappings
  });
  if (input.mode === "STRICT" && normalized.errors.length) return { imported: 0, errors: normalized.errors, status: "REJECTED" as const };
  for (let index = 0; index < normalized.facts.length; index += 450) {
    const batch = adminDb().batch();
    for (const fact of normalized.facts.slice(index, index + 450)) {
      batch.set(projectRef(input.projectId).collection("facts").doc(documentId(fact.sourceRowKey)), fact, { merge: true });
    }
    await batch.commit();
  }
  return { imported: normalized.facts.length, errors: normalized.errors, status: normalized.errors.length ? "PARTIAL" as const : "IMPORTED" as const };
}

export async function runStoredProject(input: {
  projectId: string; organizationId: string; asOfDate: string; runAt: string;
}) {
  const bundle = await getProjectBundle(input.projectId, input.organizationId);
  const factsSnapshot = await projectRef(input.projectId).collection("facts")
    .where("date", ">=", bundle.config.startDate).where("date", "<=", input.asOfDate).get();
  const actionsSnapshot = await projectRef(input.projectId).collection("actionQueue")
    .where("approvalStatus", "in", ["PENDING", "DEFERRED"]).get();
  const output = runOptimizationEngine({
    asOfDate: input.asOfDate, runAt: input.runAt, config: bundle.config,
    metricDefinitions: bundle.metricDefinitions, rules: bundle.rules,
    facts: factsSnapshot.docs.map((document) => document.data() as FactRow),
    priorActions: actionsSnapshot.docs.map((document) => document.data())
  });
  await projectRef(input.projectId).collection("runs").doc(output.runId).set(output);
  for (let index = 0; index < output.actions.length; index += 450) {
    const batch = adminDb().batch();
    for (const action of output.actions.slice(index, index + 450)) batch.set(projectRef(input.projectId).collection("actionQueue").doc(action.id), action);
    await batch.commit();
  }
  return output;
}

export async function updateStoredAction(input: {
  projectId: string; organizationId: string; actionId: string; to: ApprovalStatus;
  actor: string; at: string; note: string | null;
}) {
  await assertProjectAccess(input.projectId, input.organizationId);
  const actionRef = projectRef(input.projectId).collection("actionQueue").doc(input.actionId);
  return adminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(actionRef);
    if (!snapshot.exists) throw new Error("ACTION_NOT_FOUND");
    const result = transitionAction(snapshot.data() as ActionRecord, input.to, input.actor, input.at, input.note);
    transaction.set(actionRef, result.action);
    transaction.set(projectRef(input.projectId).collection("actionLog").doc(result.event.id), result.event);
    return result;
  });
}

export async function listStoredActions(projectId: string, organizationId: string, status?: ApprovalStatus) {
  await assertProjectAccess(projectId, organizationId);
  let query: FirebaseFirestore.Query = projectRef(projectId).collection("actionQueue");
  if (status) query = query.where("approvalStatus", "==", status);
  const snapshot = await query.orderBy("runAt", "desc").limit(500).get();
  return snapshot.docs.map((document) => document.data() as ActionRecord);
}

export async function listStoredRuns(projectId: string, organizationId: string) {
  await assertProjectAccess(projectId, organizationId);
  const snapshot = await projectRef(projectId).collection("runs").orderBy("runAt", "desc").limit(50).get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return { runId: document.id, runAt: data.runAt, status: data.status, qc: data.qc, recommendationCount: data.recommendations?.length ?? 0, actionCount: data.actions?.length ?? 0 };
  });
}
